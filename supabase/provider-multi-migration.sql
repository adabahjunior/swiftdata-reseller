-- Multi-provider Datahub support (primary + secondary)

alter table public.orders
  add column if not exists provider_name text;

create index if not exists idx_orders_provider_name
  on public.orders(provider_name)
  where provider_name is not null;

insert into public.site_settings (key, value, label) values
  ('active_data_provider', 'primary', 'Active data provider (primary or secondary)'),
  ('data_provider_primary_name', 'Primary Datahub', 'Display name for primary provider'),
  ('data_provider_secondary_name', 'Secondary Datahub', 'Display name for secondary provider'),
  ('data_provider_primary_api_key', '', 'Primary Datahub API key'),
  ('data_provider_secondary_api_key', '', 'Secondary Datahub API key')
on conflict (key) do nothing;

-- Restrict provider API keys to admins only (non-admins can still read other site settings)
drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
  on public.site_settings for select to authenticated
  using (
    public.is_admin()
    or key not in (
      'data_provider_primary_api_key',
      'data_provider_secondary_api_key'
    )
  );
