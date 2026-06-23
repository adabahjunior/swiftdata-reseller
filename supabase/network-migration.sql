-- Standardize network IDs: mtn, yellow, at_ishare, at_bigtime, telecel

-- Step 1: Drop old constraint so we can update values
alter table public.data_packages drop constraint if exists data_packages_network_check;

-- Step 2: Migrate existing rows
update public.data_packages set network = 'at_ishare' where network = 'airteltigo_ishare';
update public.data_packages set network = 'at_bigtime' where network = 'airteltigo_bigtime';
update public.orders set network = 'at_ishare' where network = 'airteltigo_ishare';
update public.orders set network = 'at_bigtime' where network = 'airteltigo_bigtime';

-- Step 3: Apply new constraint
alter table public.data_packages add constraint data_packages_network_check
  check (network in ('mtn', 'yellow', 'at_ishare', 'at_bigtime', 'telecel'));

-- Step 4: Add Yellow packages if none exist
insert into public.data_packages (network, size_gb, price, validity)
select * from (values
  ('yellow'::text, 1::numeric, 4.30::numeric, 'Non expiry'::text),
  ('yellow', 2, 8.20, 'Non expiry'),
  ('yellow', 5, 19.50, 'Non expiry')
) as seed(network, size_gb, price, validity)
where not exists (select 1 from public.data_packages where network = 'yellow');

-- Atomic API buy-data function
create or replace function public.api_buy_data(
  p_user_id uuid,
  p_api_key_id uuid,
  p_package_id uuid,
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
begin
  select value into v_api_enabled from site_settings where key = 'api_enabled';
  select value into v_maintenance from site_settings where key = 'maintenance_mode';

  if coalesce(v_api_enabled, 'true') = 'false' then
    return jsonb_build_object('success', false, 'error', 'API is currently disabled');
  end if;

  if coalesce(v_maintenance, 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  select * into v_pkg from data_packages where id = p_package_id and active = true;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  end if;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User profile not found');
  end if;

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
  values (p_user_id, 'debit', v_pkg.price, 'API data purchase: ' || v_pkg.network || ' ' || v_pkg.size_gb || 'GB -> ' || p_phone, v_ref);

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

create or replace function public.api_validate_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_key record;
begin
  select id, user_id, name, key_prefix, is_active into v_key
  from api_keys where key_value = p_key and is_active = true;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'key_id', v_key.id,
    'user_id', v_key.user_id,
    'key_prefix', v_key.key_prefix
  );
end;
$func$;
