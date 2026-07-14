-- Configure secondary provider as SK Plug (Datahub remains primary)

insert into public.site_settings (key, value, label) values
  ('data_provider_primary_type', 'datahub', 'Primary provider API type (datahub or skplug)'),
  ('data_provider_secondary_type', 'skplug', 'Secondary provider API type (datahub or skplug)'),
  ('data_provider_secondary_name', 'SK Plug', 'Display name for secondary provider')
on conflict (key) do update set
  value = excluded.value,
  label = excluded.label,
  updated_at = now();

-- Ensure primary defaults stay Datahub-typed
insert into public.site_settings (key, value, label) values
  ('data_provider_primary_name', 'Primary Datahub', 'Display name for primary provider')
on conflict (key) do nothing;

update public.site_settings
set label = 'Primary Datahub API key',
    updated_at = now()
where key = 'data_provider_primary_api_key';

update public.site_settings
set label = 'Secondary SK Plug API token',
    updated_at = now()
where key = 'data_provider_secondary_api_key';
