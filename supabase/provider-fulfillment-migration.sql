-- Datahub Ghana provider fulfillment tracking

alter table public.orders
  add column if not exists provider_reference text,
  add column if not exists provider_order_number text,
  add column if not exists provider_status text,
  add column if not exists provider_error text,
  add column if not exists provider_submitted_at timestamptz;

create index if not exists idx_orders_provider_pending
  on public.orders(created_at asc)
  where provider_submitted_at is null
    and admin_visible = true
    and status in ('pending', 'processing', 'completed');

insert into public.site_settings (key, value, label) values
  ('provider_fulfillment_enabled', 'true', 'Forward orders to Datahub provider'),
  ('provider_mtn_network_key', 'YELLO', 'MTN provider network key (YELLO or MTN_XPRESS)')
on conflict (key) do nothing;

-- Map DB network to Datahub networkKey
create or replace function public.db_network_to_provider_key(p_network text)
returns text
language sql
stable
as $$
  select case lower(trim(p_network))
    when 'mtn' then coalesce(
      (select value from site_settings where key = 'provider_mtn_network_key' limit 1),
      'YELLO'
    )
    when 'at_ishare' then 'AT_PREMIUM'
    when 'at_bigtime' then 'AT_BIGTIME'
    when 'telecel' then 'TELECEL'
    else upper(trim(p_network))
  end;
$$;

-- Orders eligible for provider submission
create or replace function public.get_orders_pending_provider(p_limit integer default 50)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select *
  from orders
  where provider_submitted_at is null
    and admin_visible = true
    and status in ('pending', 'processing', 'completed')
    and coalesce(
      (select value from site_settings where key = 'provider_fulfillment_enabled' limit 1),
      'true'
    ) = 'true'
  order by created_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_orders_pending_provider to service_role;
