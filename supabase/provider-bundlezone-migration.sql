-- Fourth purchase provider slot (BundleZone) + hide its secrets from non-admins

insert into public.site_settings (key, value, label) values
  ('data_provider_quaternary_type', 'bundlezone', 'Quaternary provider API type (datahub, skplug, datamart, or bundlezone)'),
  ('data_provider_quaternary_name', 'BundleZone', 'Display name for quaternary provider'),
  ('data_provider_quaternary_api_key', '', 'Quaternary provider API key'),
  ('bundlezone_webhook_secret', '', 'BundleZone webhook secret for X-BundleZone-Signature')
on conflict (key) do nothing;

update public.site_settings
set label = 'Active data provider (primary, secondary, tertiary, or quaternary)',
    updated_at = now()
where key = 'active_data_provider';

update public.site_settings
set label = replace(label, '(datahub, skplug, or datamart)', '(datahub, skplug, datamart, or bundlezone)'),
    updated_at = now()
where key in ('data_provider_primary_type', 'data_provider_secondary_type', 'data_provider_tertiary_type');

drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
  on public.site_settings for select to authenticated
  using (
    public.is_admin()
    or key not in (
      'data_provider_primary_api_key',
      'data_provider_secondary_api_key',
      'data_provider_tertiary_api_key',
      'data_provider_quaternary_api_key',
      'datamart_api_key',
      'datahub_webhook_secret',
      'bundlezone_webhook_secret',
      'sms_api_key',
      'xcel_pin',
      'xcel_hmac_secret',
      'xcel_api_key'
    )
  );
