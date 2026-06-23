-- Order export downloads: batch up to 50 orders per Excel file

alter table public.orders
  add column if not exists export_download_id uuid;

create table if not exists public.order_export_downloads (
  id uuid primary key default gen_random_uuid(),
  order_ids uuid[] not null,
  order_count integer not null check (order_count > 0 and order_count <= 50),
  first_order_at timestamptz,
  last_order_at timestamptz,
  downloaded_at timestamptz not null default now(),
  downloaded_by uuid references public.profiles(id) on delete set null,
  download_count integer not null default 1,
  file_label text not null,
  created_at timestamptz not null default now()
);

alter table public.orders
  drop constraint if exists orders_export_download_id_fkey;

alter table public.orders
  add constraint orders_export_download_id_fkey
  foreign key (export_download_id) references public.order_export_downloads(id) on delete set null;

create index if not exists idx_orders_export_download_id on public.orders(export_download_id);
create index if not exists idx_orders_unexported on public.orders(created_at asc) where export_download_id is null;

alter table public.order_export_downloads enable row level security;

drop policy if exists "Admins manage order exports" on public.order_export_downloads;
create policy "Admins manage order exports"
  on public.order_export_downloads for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Create next export batch (up to 50 oldest unexported orders)
create or replace function public.admin_create_order_export(p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_order_ids uuid[];
  v_count integer;
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_download_id uuid;
  v_label text;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select array_agg(id order by created_at asc),
         count(*)::integer,
         min(created_at),
         max(created_at)
  into v_order_ids, v_count, v_first_at, v_last_at
  from (
    select id, created_at
    from orders
    where export_download_id is null
    order by created_at asc
    limit 50
  ) sub;

  if v_count is null or v_count = 0 then
    return jsonb_build_object('success', false, 'error', 'No unexported orders available');
  end if;

  v_label := 'orders-export-' || to_char(now(), 'YYYY-MM-DD') || '-batch-' ||
    (select coalesce(count(*), 0) + 1 from order_export_downloads);

  insert into order_export_downloads (
    order_ids, order_count, first_order_at, last_order_at, downloaded_by, file_label
  )
  values (v_order_ids, v_count, v_first_at, v_last_at, p_admin_id, v_label)
  returning id into v_download_id;

  update orders
  set export_download_id = v_download_id
  where id = any(v_order_ids);

  return jsonb_build_object(
    'success', true,
    'download_id', v_download_id,
    'order_ids', to_jsonb(v_order_ids),
    'order_count', v_count,
    'file_label', v_label
  );
end;
$func$;

-- Record a re-download of an existing batch
create or replace function public.admin_record_order_redownload(p_admin_id uuid, p_download_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if not exists (select 1 from order_export_downloads where id = p_download_id) then
    return jsonb_build_object('success', false, 'error', 'Export batch not found');
  end if;

  update order_export_downloads
  set download_count = download_count + 1,
      downloaded_at = now(),
      downloaded_by = p_admin_id
  where id = p_download_id;

  return jsonb_build_object('success', true);
end;
$func$;

grant execute on function public.admin_create_order_export to authenticated;
grant execute on function public.admin_record_order_redownload to authenticated;

-- Enable realtime for live order updates on dashboards
alter table public.orders replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.order_export_downloads;
exception
  when duplicate_object then null;
end $$;
