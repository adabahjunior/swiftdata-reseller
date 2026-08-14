-- Third purchase provider slot (Datahub) + hide extra secrets from non-admins

insert into public.site_settings (key, value, label) values
  ('data_provider_tertiary_type', 'datahub', 'Tertiary provider API type (datahub, skplug, or datamart)'),
  ('data_provider_tertiary_name', 'Datahub', 'Display name for tertiary provider'),
  ('data_provider_tertiary_api_key', '', 'Tertiary provider API key'),
  ('datahub_webhook_secret', '', 'Datahub HMAC secret for X-Webhook-Signature')
on conflict (key) do nothing;

update public.site_settings
set label = 'Active data provider (primary, secondary, or tertiary)',
    updated_at = now()
where key = 'active_data_provider';

drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
  on public.site_settings for select to authenticated
  using (
    public.is_admin()
    or key not in (
      'data_provider_primary_api_key',
      'data_provider_secondary_api_key',
      'data_provider_tertiary_api_key',
      'datamart_api_key',
      'datahub_webhook_secret',
      'sms_api_key',
      'xcel_pin',
      'xcel_hmac_secret',
      'xcel_api_key'
    )
  );
