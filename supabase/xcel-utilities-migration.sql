-- Xcel utilities: Airtime, ECG, TV subscriptions
-- Parallel to data packages; fulfilled via Xcel POST /partners/utilities/buy

alter table public.orders
  add column if not exists service_type text not null default 'data',
  add column if not exists utility_product_id uuid,
  add column if not exists face_amount numeric(12, 2),
  add column if not exists utility_meta jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_service_type_check'
  ) then
    alter table public.orders
      add constraint orders_service_type_check
      check (service_type in ('data', 'airtime', 'ecg', 'tv'));
  end if;
end $$;

create index if not exists idx_orders_service_type on public.orders(service_type);
create index if not exists idx_orders_xcel_pending
  on public.orders(created_at asc)
  where provider_submitted_at is null
    and admin_visible = true
    and status in ('pending', 'processing', 'completed')
    and service_type in ('airtime', 'ecg', 'tv');

create table if not exists public.utility_products (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type in ('airtime', 'ecg', 'tv')),
  provider_code text not null,
  label text not null,
  min_amount numeric(12, 2) not null default 1,
  max_amount numeric(12, 2) not null default 5000,
  markup_percent numeric(8, 4) not null default 0,
  flat_fee numeric(12, 2) not null default 0,
  xcel_merchant_id text,
  xcel_to_acct text,
  xcel_biller_wallet_num text,
  xcel_account_name text,
  bill_sub_type text,
  xcel_type text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_type, provider_code)
);

alter table public.utility_products enable row level security;

drop policy if exists "Anyone authenticated can read active utility products" on public.utility_products;
create policy "Anyone authenticated can read active utility products"
  on public.utility_products for select to authenticated
  using (active = true or public.is_admin());

drop policy if exists "Admins manage utility products" on public.utility_products;
create policy "Admins manage utility products"
  on public.utility_products for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.orders
  drop constraint if exists orders_utility_product_id_fkey;
alter table public.orders
  add constraint orders_utility_product_id_fkey
  foreign key (utility_product_id) references public.utility_products(id);

insert into public.site_settings (key, value, label) values
  ('xcel_enabled', 'false', 'Enable Xcel Airtime / ECG / TV fulfillment'),
  ('xcel_api_base', 'https://api.xcelapp.com', 'Xcel API base URL'),
  ('xcel_dl_code_path', '/partners/momo/dl-code', 'Xcel DL-code path'),
  ('xcel_buy_path', '/partners/utilities/buy', 'Xcel utilities buy path'),
  ('xcel_user_id', '', 'Xcel partner user_id'),
  ('xcel_pin', '', 'Xcel partner PIN'),
  ('xcel_from_acct', '', 'Xcel debit/from account number'),
  ('xcel_hmac_secret', '', 'Xcel HMAC / API secret'),
  ('xcel_api_key', '', 'Xcel API key (Authorization header if required)'),
  ('xcel_default_merchant_id', '', 'Default Xcel merchant ID (from VAS list)'),
  ('xcel_biller_channel', 'FUNDGATE', 'Xcel biller_channel')
on conflict (key) do nothing;

insert into public.utility_products (
  service_type, provider_code, label, min_amount, max_amount,
  bill_sub_type, xcel_type, display_order
) values
  ('airtime', 'MTN', 'MTN Airtime', 1, 500, 'airtime', 'topup', 10),
  ('airtime', 'TELECEL', 'Telecel Airtime', 1, 500, 'airtime', 'topup', 20),
  ('airtime', 'AT', 'AirtelTigo Airtime', 1, 500, 'airtime', 'topup', 30),
  ('ecg', 'ecg2', 'ECG Prepaid / Postpaid', 1, 5000, 'electricity', 'electricity', 10),
  ('tv', 'DSTV', 'DSTV', 1, 5000, 'CABLE', 'cable', 10),
  ('tv', 'GOTV', 'GOtv', 1, 5000, 'CABLE', 'cable', 20),
  ('tv', 'STARTIMES', 'StarTimes', 1, 5000, 'CABLE', 'cable', 30),
  ('tv', 'BOX_OFFICE', 'Box Office', 1, 5000, 'CABLE', 'cable', 40)
on conflict (service_type, provider_code) do nothing;

-- Data provider queue must ignore utility orders
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
    and coalesce(service_type, 'data') = 'data'
    and coalesce(
      (select value from site_settings where key = 'provider_fulfillment_enabled' limit 1),
      'true'
    ) = 'true'
  order by created_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_orders_pending_provider to service_role;

create or replace function public.get_orders_pending_xcel(p_limit integer default 50)
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
    and service_type in ('airtime', 'ecg', 'tv')
    and coalesce(
      (select value from site_settings where key = 'xcel_enabled' limit 1),
      'false'
    ) = 'true'
  order by created_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_orders_pending_xcel to service_role;

create or replace function public.utility_charge_amount(
  p_face_amount numeric,
  p_markup_percent numeric,
  p_flat_fee numeric
)
returns numeric
language sql
immutable
as $$
  select round(
    greatest(p_face_amount, 0)
      + (greatest(p_face_amount, 0) * greatest(coalesce(p_markup_percent, 0), 0) / 100.0)
      + greatest(coalesce(p_flat_fee, 0), 0),
    2
  );
$$;

create or replace function public.dashboard_place_utility_order(
  p_user_id uuid,
  p_service_type text,
  p_provider_code text,
  p_beneficiary text,
  p_face_amount numeric,
  p_account_name text default null,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_product record;
  v_charge numeric;
  v_balance numeric;
  v_ref text;
  v_order_id uuid;
  v_maintenance text;
  v_xcel text;
  v_profile record;
  v_auto_seconds integer;
  v_final_status text;
  v_beneficiary text;
  v_meta jsonb;
begin
  if p_service_type not in ('airtime', 'ecg', 'tv') then
    return jsonb_build_object('success', false, 'error', 'Invalid service_type');
  end if;

  v_beneficiary := trim(coalesce(p_beneficiary, ''));
  if v_beneficiary = '' then
    return jsonb_build_object('success', false, 'error', 'Beneficiary is required');
  end if;

  if p_service_type = 'airtime' and v_beneficiary !~ '^0[2-5][0-9]{8}$' then
    return jsonb_build_object('success', false, 'error', 'Invalid phone. Use Ghana format e.g. 0241234567');
  end if;

  if coalesce(p_face_amount, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'amount must be greater than 0');
  end if;

  select is_active into v_profile from profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    return jsonb_build_object('success', false, 'error', 'Account is deactivated');
  end if;

  select value into v_maintenance from site_settings where key = 'maintenance_mode';
  if coalesce(v_maintenance, 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  select value into v_xcel from site_settings where key = 'xcel_enabled';
  if coalesce(v_xcel, 'false') <> 'true' then
    return jsonb_build_object('success', false, 'error', 'Utility services are not enabled yet');
  end if;

  select * into v_product
  from utility_products
  where service_type = p_service_type
    and upper(provider_code) = upper(trim(p_provider_code))
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No active product for ' || p_service_type || '/' || p_provider_code);
  end if;

  if p_face_amount < v_product.min_amount or p_face_amount > v_product.max_amount then
    return jsonb_build_object(
      'success', false,
      'error',
      'Amount must be between ' || v_product.min_amount || ' and ' || v_product.max_amount
    );
  end if;

  v_charge := public.utility_charge_amount(p_face_amount, v_product.markup_percent, v_product.flat_fee);
  v_ref := 'UTL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_meta := coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
    'account_name', nullif(trim(coalesce(p_account_name, '')), ''),
    'provider_code', v_product.provider_code,
    'bill_sub_type', v_product.bill_sub_type,
    'xcel_type', v_product.xcel_type
  );

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_charge then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, failure_reason, admin_visible, order_source,
      service_type, utility_product_id, face_amount, utility_meta
    )
    values (
      p_user_id, v_ref, v_beneficiary, lower(v_product.provider_code), null, 0, v_charge,
      'failed', 'insufficient_balance', false, 'dashboard',
      p_service_type, v_product.id, p_face_amount, v_meta
    )
    returning id into v_order_id;

    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient API balance',
      'order', jsonb_build_object('id', v_order_id, 'reference', v_ref, 'status', 'failed')
    );
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  -- Utilities stay pending until Xcel confirms (ignore instant-complete for data)
  v_final_status := 'pending';

  update profiles set wallet_balance = wallet_balance - v_charge, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, admin_visible, completed_at, order_source,
    service_type, utility_product_id, face_amount, utility_meta
  )
  values (
    p_user_id, v_ref, v_beneficiary, lower(v_product.provider_code), null, 0, v_charge,
    v_final_status, true, null, 'dashboard',
    p_service_type, v_product.id, p_face_amount, v_meta
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (
    p_user_id, 'debit', v_charge,
    upper(p_service_type) || ' ' || v_product.provider_code || ' GHS' || p_face_amount::text || ' -> ' || v_beneficiary,
    v_ref
  );

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'service_type', p_service_type,
      'provider_code', v_product.provider_code,
      'beneficiary', v_beneficiary,
      'face_amount', p_face_amount,
      'amount', v_charge,
      'status', v_final_status
    )
  );
end;
$func$;

create or replace function public.api_buy_utility(
  p_user_id uuid,
  p_api_key_id uuid,
  p_service_type text,
  p_provider_code text,
  p_beneficiary text,
  p_face_amount numeric,
  p_reference text default null,
  p_account_name text default null,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_product record;
  v_charge numeric;
  v_balance numeric;
  v_ref text;
  v_order_id uuid;
  v_maintenance text;
  v_xcel text;
  v_api_enabled text;
  v_profile record;
  v_beneficiary text;
  v_meta jsonb;
begin
  if p_service_type not in ('airtime', 'ecg', 'tv') then
    return jsonb_build_object('success', false, 'error', 'Invalid service_type');
  end if;

  v_beneficiary := trim(coalesce(p_beneficiary, ''));
  if v_beneficiary = '' then
    return jsonb_build_object('success', false, 'error', 'beneficiary is required');
  end if;

  if p_service_type = 'airtime' and v_beneficiary !~ '^0[2-5][0-9]{8}$' then
    return jsonb_build_object('success', false, 'error', 'Invalid phone. Use Ghana format e.g. 0241234567');
  end if;

  if coalesce(p_face_amount, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'amount must be greater than 0');
  end if;

  select is_active, api_enabled into v_profile from profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    return jsonb_build_object('success', false, 'error', 'Account is deactivated');
  end if;
  if not coalesce(v_profile.api_enabled, true) then
    return jsonb_build_object('success', false, 'error', 'API access disabled for this account');
  end if;

  select value into v_api_enabled from site_settings where key = 'api_enabled';
  if coalesce(v_api_enabled, 'true') = 'false' then
    return jsonb_build_object('success', false, 'error', 'API is temporarily disabled');
  end if;

  select value into v_maintenance from site_settings where key = 'maintenance_mode';
  if coalesce(v_maintenance, 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  select value into v_xcel from site_settings where key = 'xcel_enabled';
  if coalesce(v_xcel, 'false') <> 'true' then
    return jsonb_build_object('success', false, 'error', 'Utility services are not enabled yet');
  end if;

  select * into v_product
  from utility_products
  where service_type = p_service_type
    and upper(provider_code) = upper(trim(p_provider_code))
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No active product for ' || p_service_type || '/' || p_provider_code);
  end if;

  if p_face_amount < v_product.min_amount or p_face_amount > v_product.max_amount then
    return jsonb_build_object(
      'success', false,
      'error',
      'Amount must be between ' || v_product.min_amount || ' and ' || v_product.max_amount
    );
  end if;

  v_charge := public.utility_charge_amount(p_face_amount, v_product.markup_percent, v_product.flat_fee);
  v_ref := coalesce(nullif(trim(p_reference), ''), 'UTL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
  v_meta := coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
    'account_name', nullif(trim(coalesce(p_account_name, '')), ''),
    'provider_code', v_product.provider_code,
    'bill_sub_type', v_product.bill_sub_type,
    'xcel_type', v_product.xcel_type
  );

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_charge then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, failure_reason, admin_visible, order_source, api_key_id,
      service_type, utility_product_id, face_amount, utility_meta
    )
    values (
      p_user_id, v_ref, v_beneficiary, lower(v_product.provider_code), null, 0, v_charge,
      'failed', 'insufficient_balance', false, 'api', p_api_key_id,
      p_service_type, v_product.id, p_face_amount, v_meta
    )
    returning id into v_order_id;

    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient API balance',
      'order', jsonb_build_object('id', v_order_id, 'reference', v_ref, 'status', 'failed')
    );
  end if;

  update profiles set wallet_balance = wallet_balance - v_charge, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, admin_visible, order_source, api_key_id,
    service_type, utility_product_id, face_amount, utility_meta
  )
  values (
    p_user_id, v_ref, v_beneficiary, lower(v_product.provider_code), null, 0, v_charge,
    'pending', true, 'api', p_api_key_id,
    p_service_type, v_product.id, p_face_amount, v_meta
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (
    p_user_id, 'debit', v_charge,
    'API ' || upper(p_service_type) || ' ' || v_product.provider_code || ' GHS' || p_face_amount::text || ' -> ' || v_beneficiary,
    v_ref
  );

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'service_type', p_service_type,
      'provider_code', v_product.provider_code,
      'beneficiary', v_beneficiary,
      'face_amount', p_face_amount,
      'amount', v_charge,
      'status', 'pending'
    )
  );
end;
$func$;

grant execute on function public.dashboard_place_utility_order to authenticated;
grant execute on function public.api_buy_utility to service_role;
grant execute on function public.utility_charge_amount to authenticated;
grant execute on function public.utility_charge_amount to service_role;
