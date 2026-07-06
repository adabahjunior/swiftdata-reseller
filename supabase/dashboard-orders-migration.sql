-- Dashboard single & bulk orders (visible to admin on success)

alter table public.orders
  add column if not exists order_source text not null default 'api';

alter table public.orders drop constraint if exists orders_order_source_check;
alter table public.orders add constraint orders_order_source_check
  check (order_source in ('api', 'dashboard'));

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

  v_ref := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_pkg.price then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, failure_reason, admin_visible, order_source
    )
    values (
      p_user_id, v_ref, v_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price,
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

  update profiles set wallet_balance = wallet_balance - v_pkg.price, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, admin_visible, completed_at, order_source
  )
  values (
    p_user_id, v_ref, v_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price,
    v_final_status, true,
    case when v_final_status = 'completed' then now() else null end,
    'dashboard'
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (
    p_user_id, 'debit', v_pkg.price,
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
      'amount', v_pkg.price,
      'status', v_final_status
    )
  );
end;
$func$;

create or replace function public.dashboard_place_bulk_orders(
  p_user_id uuid,
  p_orders jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_success integer := 0;
  v_failed integer := 0;
begin
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    return jsonb_build_object('success', false, 'error', 'Provide at least one order');
  end if;

  if jsonb_array_length(p_orders) > 100 then
    return jsonb_build_object('success', false, 'error', 'Maximum 100 orders per bulk submit');
  end if;

  for v_item in select value from jsonb_array_elements(p_orders)
  loop
    v_result := public.dashboard_place_order(
      p_user_id,
      v_item->>'network',
      (v_item->>'size_gb')::numeric,
      v_item->>'phone'
    );

    if coalesce((v_result->>'success')::boolean, false) then
      v_success := v_success + 1;
    else
      v_failed := v_failed + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      v_result || jsonb_build_object(
        'phone', v_item->>'phone',
        'network', v_item->>'network',
        'size_gb', v_item->>'size_gb'
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'succeeded', v_success,
    'failed', v_failed,
    'results', v_results
  );
end;
$func$;

grant execute on function public.dashboard_place_order to authenticated;
grant execute on function public.dashboard_place_bulk_orders to authenticated;
