-- Provider type on orders + support WhatsApp contacts + status sync RPC

alter table public.orders
  add column if not exists provider_type text;

create table if not exists public.support_contacts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  phone text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_contacts_active
  on public.support_contacts(display_order asc)
  where active = true;

alter table public.support_contacts enable row level security;

drop policy if exists "Anyone authenticated can view active support contacts" on public.support_contacts;
create policy "Anyone authenticated can view active support contacts"
  on public.support_contacts for select to authenticated
  using (active = true or public.is_admin());

drop policy if exists "Admins manage support contacts" on public.support_contacts;
create policy "Admins manage support contacts"
  on public.support_contacts for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.site_settings (key, value, label) values
  ('provider_status_sync_enabled', 'true', 'Poll provider APIs for live order status updates'),
  ('datahub_webhook_url', '', 'Registered Datahub webhook callback URL (auto-managed)')
on conflict (key) do nothing;

-- Orders awaiting provider status sync
create or replace function public.get_orders_pending_provider_status(p_limit integer default 50)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select *
  from orders
  where provider_submitted_at is not null
    and provider_status in ('submitted', 'processing')
    and status in ('pending', 'processing')
    and coalesce(
      (select value from site_settings where key = 'provider_status_sync_enabled' limit 1),
      'true'
    ) = 'true'
  order by provider_submitted_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_orders_pending_provider_status to service_role;
