-- Fifth purchase provider slot (Spendless) + hide its secrets from non-admins

insert into public.site_settings (key, value, label) values
  ('data_provider_quinary_type', 'spendless', 'Quinary provider API type (datahub, skplug, datamart, bundlezone, or spendless)'),
  ('data_provider_quinary_name', 'Spendless', 'Display name for quinary provider'),
  ('data_provider_quinary_api_key', '', 'Quinary provider API key'),
  ('spendless_webhook_secret', '', 'Spendless webhook secret for X-Webhook-Signature')
on conflict (key) do nothing;

update public.site_settings
set label = 'Active data provider (primary, secondary, tertiary, quaternary, or quinary)',
    updated_at = now()
where key = 'active_data_provider';

update public.site_settings
set label = replace(label, '(datahub, skplug, datamart, or bundlezone)', '(datahub, skplug, datamart, bundlezone, or spendless)'),
    updated_at = now()
where key in (
  'data_provider_primary_type',
  'data_provider_secondary_type',
  'data_provider_tertiary_type',
  'data_provider_quaternary_type'
);

update public.site_settings
set value = value || ',quinary',
    updated_at = now()
where key = 'provider_reroute_chain'
  and value <> ''
  and not ('quinary' = any (string_to_array(value, ',')));

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
      'data_provider_quinary_api_key',
      'datamart_api_key',
      'datahub_webhook_secret',
      'bundlezone_webhook_secret',
      'spendless_webhook_secret',
      'sms_api_key',
      'xcel_pin',
      'xcel_hmac_secret',
      'xcel_api_key'
    )
  );
