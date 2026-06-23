-- User topup codes, account controls, API buy by network+size_gb, admin credit

alter table public.profiles
  add column if not exists topup_code text unique,
  add column if not exists is_active boolean not null default true,
  add column if not exists api_enabled boolean not null default true;

create or replace function public.generate_topup_code()
returns text
language plpgsql
as $func$
declare
  result text;
begin
  loop
    result := lpad(floor(random() * 100000)::text, 5, '0');
    exit when not exists (select 1 from public.profiles where topup_code = result);
  end loop;
  return result;
end;
$func$;

-- Backfill topup codes for existing users
update public.profiles
set topup_code = public.generate_topup_code()
where topup_code is null;

alter table public.profiles alter column topup_code set not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  ref_code text;
  top_code text;
begin
  ref_code := public.generate_referral_code();
  while exists (select 1 from public.profiles where referral_code = ref_code) loop
    ref_code := public.generate_referral_code();
  end loop;

  top_code := public.generate_topup_code();

  insert into public.profiles (id, full_name, phone, email, referred_by, referral_code, topup_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.raw_user_meta_data->>'phone', null),
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'referral_code', '')), ''),
    ref_code,
    top_code
  );

  return new;
end;
$func$;

-- Map API network id to DB network id
create or replace function public.api_network_to_db(p_network text)
returns text
language sql
immutable
as $$
  select case lower(trim(p_network))
    when 'yello' then 'mtn'
    when 'mtn' then 'mtn'
    when 'at_ishare' then 'at_ishare'
    when 'at_bigtime' then 'at_bigtime'
    when 'telecel' then 'telecel'
    else lower(trim(p_network))
  end;
$$;

create or replace function public.api_validate_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_key record;
  v_profile record;
begin
  select id, user_id, name, key_prefix, is_active into v_key
  from api_keys where key_value = p_key and is_active = true;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid or inactive API key');
  end if;

  select is_active, api_enabled into v_profile from profiles where id = v_key.user_id;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'User profile not found');
  end if;

  if not v_profile.is_active then
    return jsonb_build_object('valid', false, 'error', 'Account is deactivated');
  end if;

  if not v_profile.api_enabled then
    return jsonb_build_object('valid', false, 'error', 'API access is disabled for this account');
  end if;

  return jsonb_build_object(
    'valid', true,
    'key_id', v_key.id,
    'user_id', v_key.user_id,
    'key_prefix', v_key.key_prefix
  );
end;
$func$;

create or replace function public.api_buy_data(
  p_user_id uuid,
  p_api_key_id uuid,
  p_network text,
  p_size_gb numeric,
  p_phone text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pkg record;
  v_balance numeric;
  v_ref text;
  v_order_id uuid;
  v_api_enabled text;
  v_maintenance text;
  v_db_network text;
  v_profile record;
begin
  select is_active, api_enabled into v_profile from profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    return jsonb_build_object('success', false, 'error', 'Account is deactivated');
  end if;
  if not v_profile.api_enabled then
    return jsonb_build_object('success', false, 'error', 'API access is disabled');
  end if;

  select value into v_api_enabled from site_settings where key = 'api_enabled';
  select value into v_maintenance from site_settings where key = 'maintenance_mode';

  if coalesce(v_api_enabled, 'true') = 'false' then
    return jsonb_build_object('success', false, 'error', 'API is currently disabled');
  end if;

  if coalesce(v_maintenance, 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  v_db_network := public.api_network_to_db(p_network);

  select * into v_pkg from data_packages
  where network = v_db_network and size_gb = p_size_gb and active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No active package for network ' || p_network || ' ' || p_size_gb || 'GB');
  end if;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_pkg.price then
    return jsonb_build_object('success', false, 'error', 'Insufficient API balance');
  end if;

  v_ref := coalesce(nullif(trim(p_reference), ''), 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

  if exists (select 1 from orders where reference = v_ref) then
    return jsonb_build_object('success', false, 'error', 'Reference already exists');
  end if;

  update profiles set wallet_balance = wallet_balance - v_pkg.price, updated_at = now()
  where id = p_user_id;

  insert into orders (user_id, reference, phone, network, package_id, size_gb, amount, status, api_key_id)
  values (p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price, 'processing', p_api_key_id)
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (p_user_id, 'debit', v_pkg.price,
    'API purchase: ' || v_pkg.network || ' ' || v_pkg.size_gb || 'GB -> ' || p_phone, v_ref);

  update api_keys set requests_count = requests_count + 1, last_used_at = now() where id = p_api_key_id;

  update orders set status = 'completed', completed_at = now() where id = v_order_id;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'phone', p_phone,
      'network', v_pkg.network,
      'size_gb', v_pkg.size_gb,
      'amount', v_pkg.price,
      'status', 'completed'
    )
  );
end;
$func$;

-- Admin credit wallet by topup code or user id
create or replace function public.admin_credit_wallet(
  p_admin_id uuid,
  p_amount numeric,
  p_topup_code text default null,
  p_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_target_id uuid;
  v_profile record;
  v_ref text;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Amount must be positive');
  end if;

  if p_user_id is not null then
    v_target_id := p_user_id;
  elsif p_topup_code is not null then
    select id into v_target_id from profiles where topup_code = trim(p_topup_code);
    if v_target_id is null then
      return jsonb_build_object('success', false, 'error', 'No user found with topup code ' || p_topup_code);
    end if;
  else
    return jsonb_build_object('success', false, 'error', 'Provide topup_code or user_id');
  end if;

  select * into v_profile from profiles where id = v_target_id for update;

  update profiles
  set wallet_balance = wallet_balance + p_amount, updated_at = now()
  where id = v_target_id;

  v_ref := 'CREDIT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into transactions (user_id, type, amount, description, reference)
  values (
    v_target_id,
    'credit',
    p_amount,
    coalesce(p_note, 'Manual top-up credited by admin'),
    v_ref
  );

  return jsonb_build_object(
    'success', true,
    'user_id', v_target_id,
    'topup_code', v_profile.topup_code,
    'amount', p_amount,
    'new_balance', v_profile.wallet_balance + p_amount,
    'reference', v_ref
  );
end;
$func$;

-- Allow admins to call admin_credit_wallet via RPC
grant execute on function public.admin_credit_wallet to authenticated;
grant execute on function public.api_network_to_db to authenticated;

-- Drop legacy buy-data RPC that used package_id (if present)
drop function if exists public.api_buy_data(uuid, uuid, uuid, text, text);

-- Admins can manage any user's API keys
drop policy if exists "Admins manage all api keys" on public.api_keys;
create policy "Admins manage all api keys"
  on public.api_keys for all to authenticated
  using (public.is_admin() or auth.uid() = user_id)
  with check (public.is_admin() or auth.uid() = user_id);
