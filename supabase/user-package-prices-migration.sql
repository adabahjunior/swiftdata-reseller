-- Per-user package price overrides (do not change global data_packages prices)

create table if not exists public.user_package_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  package_id uuid not null references public.data_packages(id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, package_id)
);

create index if not exists idx_user_package_prices_user
  on public.user_package_prices(user_id);

alter table public.user_package_prices enable row level security;

drop policy if exists "Users view own package prices" on public.user_package_prices;
create policy "Users view own package prices"
  on public.user_package_prices for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins manage user package prices" on public.user_package_prices;
create policy "Admins manage user package prices"
  on public.user_package_prices for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.effective_package_price(
  p_user_id uuid,
  p_package_id uuid,
  p_default numeric
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select upp.price
      from user_package_prices upp
      where upp.user_id = p_user_id
        and upp.package_id = p_package_id
      limit 1
    ),
    p_default
  );
$$;

create or replace function public.get_packages_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller uuid := auth.uid();
  v_packages jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_caller <> p_user_id and not exists (
    select 1 from profiles where id = v_caller and is_admin = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'network', p.network,
      'size_gb', p.size_gb,
      'price', public.effective_package_price(p_user_id, p.id, p.price),
      'base_price', p.price,
      'has_custom_price', exists (
        select 1 from user_package_prices upp
        where upp.user_id = p_user_id and upp.package_id = p.id
      ),
      'validity', p.validity,
      'active', p.active,
      'created_at', p.created_at
    )
    order by p.network, p.size_gb
  ), '[]'::jsonb)
  into v_packages
  from data_packages p
  where p.active = true;

  return jsonb_build_object('success', true, 'packages', v_packages);
end;
$func$;

create or replace function public.admin_set_user_package_price(
  p_admin_id uuid,
  p_user_id uuid,
  p_package_id uuid,
  p_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if p_price is null or p_price < 0 then
    return jsonb_build_object('success', false, 'error', 'Price must be zero or greater');
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  if not exists (select 1 from data_packages where id = p_package_id) then
    return jsonb_build_object('success', false, 'error', 'Package not found');
  end if;

  insert into user_package_prices (user_id, package_id, price, updated_at)
  values (p_user_id, p_package_id, p_price, now())
  on conflict (user_id, package_id) do update
  set price = excluded.price, updated_at = now();

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'package_id', p_package_id,
    'price', p_price
  );
end;
$func$;

create or replace function public.admin_clear_user_package_price(
  p_admin_id uuid,
  p_user_id uuid,
  p_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  delete from user_package_prices
  where user_id = p_user_id and package_id = p_package_id;

  return jsonb_build_object('success', true, 'cleared', true);
end;
$func$;

-- Charge user-specific price on API purchases
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
  v_price numeric;
  v_balance numeric;
  v_ref text;
  v_order_id uuid;
  v_api_enabled text;
  v_maintenance text;
  v_db_network text;
  v_profile record;
  v_auto_seconds integer;
  v_final_status text;
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

  v_price := public.effective_package_price(p_user_id, v_pkg.id, v_pkg.price);

  v_ref := coalesce(nullif(trim(p_reference), ''), 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

  if exists (select 1 from orders where reference = v_ref) then
    return jsonb_build_object('success', false, 'error', 'Reference already exists');
  end if;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_price then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, api_key_id, failure_reason, admin_visible
    )
    values (
      p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_price,
      'failed', p_api_key_id, 'insufficient_balance', false
    )
    returning id into v_order_id;

    update api_keys set requests_count = requests_count + 1, last_used_at = now() where id = p_api_key_id;

    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient API balance',
      'order', jsonb_build_object(
        'reference', v_ref,
        'phone', p_phone,
        'network', v_pkg.network,
        'size_gb', v_pkg.size_gb,
        'amount', v_price,
        'status', 'failed',
        'failure_reason', 'insufficient_balance'
      )
    );
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  v_final_status := case when coalesce(v_auto_seconds, 0) <= 0 then 'completed' else 'pending' end;

  update profiles set wallet_balance = wallet_balance - v_price, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, api_key_id, admin_visible, completed_at
  )
  values (
    p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_price,
    v_final_status, p_api_key_id, true,
    case when v_final_status = 'completed' then now() else null end
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (p_user_id, 'debit', v_price,
    'API purchase: ' || v_pkg.network || ' ' || v_pkg.size_gb || 'GB -> ' || p_phone, v_ref);

  update api_keys set requests_count = requests_count + 1, last_used_at = now() where id = p_api_key_id;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'phone', p_phone,
      'network', v_pkg.network,
      'size_gb', v_pkg.size_gb,
      'amount', v_price,
      'status', v_final_status
    )
  );
end;
$func$;

-- Charge user-specific price on dashboard purchases
create or replace function public.dashboard_place_order(
  p_user_id uuid,
  p_network text,
  p_size_gb numeric,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pkg record;
  v_price numeric;
  v_balance numeric;
  v_ref text;
  v_order_id uuid;
  v_maintenance text;
  v_db_network text;
  v_profile record;
  v_auto_seconds integer;
  v_final_status text;
  v_phone text;
begin
  v_phone := trim(p_phone);
  if v_phone = '' or v_phone !~ '^0[2-5][0-9]{8}$' then
    return jsonb_build_object('success', false, 'error', 'Invalid phone. Use Ghana format e.g. 0241234567');
  end if;

  select is_active into v_profile from profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    return jsonb_build_object('success', false, 'error', 'Account is deactivated');
  end if;

  select value into v_maintenance from site_settings where key = 'maintenance_mode';
  if coalesce(v_maintenance, 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  v_db_network := public.api_network_to_db(p_network);

  select * into v_pkg from data_packages
  where network = v_db_network and size_gb = p_size_gb and active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No active package for ' || p_network || ' ' || p_size_gb || 'GB');
  end if;

  v_price := public.effective_package_price(p_user_id, v_pkg.id, v_pkg.price);

  v_ref := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_price then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, failure_reason, admin_visible, order_source
    )
    values (
      p_user_id, v_ref, v_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_price,
      'failed', 'insufficient_balance', false, 'dashboard'
    )
    returning id into v_order_id;

    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient API balance',
      'order', jsonb_build_object(
        'id', v_order_id,
        'reference', v_ref,
        'status', 'failed'
      )
    );
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  v_final_status := case when coalesce(v_auto_seconds, 0) <= 0 then 'completed' else 'pending' end;

  update profiles set wallet_balance = wallet_balance - v_price, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, admin_visible, completed_at, order_source
  )
  values (
    p_user_id, v_ref, v_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_price,
    v_final_status, true,
    case when v_final_status = 'completed' then now() else null end,
    'dashboard'
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (
    p_user_id, 'debit', v_price,
    'Dashboard order: ' || v_pkg.network || ' ' || v_pkg.size_gb || 'GB -> ' || v_phone,
    v_ref
  );

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'phone', v_phone,
      'network', v_pkg.network,
      'size_gb', v_pkg.size_gb,
      'amount', v_price,
      'status', v_final_status
    )
  );
end;
$func$;

grant execute on function public.effective_package_price to authenticated;
grant execute on function public.get_packages_for_user to authenticated;
grant execute on function public.admin_set_user_package_price to authenticated;
grant execute on function public.admin_clear_user_package_price to authenticated;
grant execute on function public.api_buy_data to service_role;
grant execute on function public.dashboard_place_order to authenticated;
