-- Auto-deliver timer + order tracking by phone

insert into public.site_settings (key, value, label) values
  ('order_auto_deliver_seconds', '120', 'Auto-deliver timer (seconds)')
on conflict (key) do nothing;

create or replace function public.auto_deliver_pending_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_seconds integer;
  v_count integer;
begin
  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_seconds
  from site_settings
  where key = 'order_auto_deliver_seconds';

  if v_seconds is null or v_seconds <= 0 then
    return 0;
  end if;

  update orders
  set status = 'completed', completed_at = now()
  where status in ('pending', 'processing')
    and admin_visible = true
    and created_at <= now() - make_interval(secs => v_seconds);

  get diagnostics v_count = row_count;
  return v_count;
end;
$func$;

create or replace function public.track_orders_by_phone(
  p_user_id uuid,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_phone text;
  v_orders jsonb;
begin
  v_phone := trim(p_phone);
  if v_phone = '' then
    return jsonb_build_object('success', false, 'error', 'Phone number is required');
  end if;

  perform public.auto_deliver_pending_orders();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'reference', o.reference,
      'phone', o.phone,
      'network', o.network,
      'size_gb', o.size_gb,
      'amount', o.amount,
      'status', o.status,
      'failure_reason', o.failure_reason,
      'created_at', o.created_at,
      'completed_at', o.completed_at
    )
    order by o.created_at desc
  ), '[]'::jsonb)
  into v_orders
  from orders o
  where o.user_id = p_user_id
    and o.phone = v_phone;

  return jsonb_build_object(
    'success', true,
    'phone', v_phone,
    'orders', v_orders
  );
end;
$func$;

grant execute on function public.auto_deliver_pending_orders to authenticated;
grant execute on function public.track_orders_by_phone to authenticated;

-- New API/retry orders start as pending; instant complete only when timer is 0
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

  v_ref := coalesce(nullif(trim(p_reference), ''), 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

  if exists (select 1 from orders where reference = v_ref) then
    return jsonb_build_object('success', false, 'error', 'Reference already exists');
  end if;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_pkg.price then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, api_key_id, failure_reason, admin_visible
    )
    values (
      p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price,
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
        'amount', v_pkg.price,
        'status', 'failed',
        'failure_reason', 'insufficient_balance'
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
    status, api_key_id, admin_visible, completed_at
  )
  values (
    p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price,
    v_final_status, p_api_key_id, true,
    case when v_final_status = 'completed' then now() else null end
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (p_user_id, 'debit', v_pkg.price,
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
      'amount', v_pkg.price,
      'status', v_final_status
    )
  );
end;
$func$;

create or replace function public.retry_failed_order(
  p_user_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_order record;
  v_balance numeric;
  v_auto_seconds integer;
  v_final_status text;
begin
  select * into v_order
  from orders
  where id = p_order_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_order.status <> 'failed' then
    return jsonb_build_object('success', false, 'error', 'Only failed orders can be retried');
  end if;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_order.amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient API balance. Top up your wallet and try again.');
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  v_final_status := case when coalesce(v_auto_seconds, 0) <= 0 then 'completed' else 'pending' end;

  update profiles
  set wallet_balance = wallet_balance - v_order.amount, updated_at = now()
  where id = p_user_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (
    p_user_id,
    'debit',
    v_order.amount,
    'Retry: ' || v_order.network || ' ' || v_order.size_gb || 'GB -> ' || v_order.phone,
    v_order.reference
  );

  update orders
  set
    status = v_final_status,
    failure_reason = null,
    admin_visible = true,
    completed_at = case when v_final_status = 'completed' then now() else null end
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'status', v_final_status
    )
  );
end;
$func$;
