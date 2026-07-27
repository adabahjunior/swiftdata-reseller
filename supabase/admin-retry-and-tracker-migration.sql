-- Admin retry for failed orders + smarter user retry + live tracker fields

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

  if v_order.failure_reason = 'insufficient_balance' then
    select wallet_balance into v_balance from profiles where id = p_user_id for update;

    if v_balance < v_order.amount then
      return jsonb_build_object('success', false, 'error', 'Insufficient API balance. Top up your wallet and try again.');
    end if;

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
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  v_final_status := case when coalesce(v_auto_seconds, 0) <= 0 then 'completed' else 'pending' end;

  update orders
  set
    status = v_final_status,
    failure_reason = null,
    admin_visible = true,
    completed_at = case when v_final_status = 'completed' then now() else null end,
    provider_submitted_at = null,
    provider_status = null,
    provider_reference = null,
    provider_order_number = null,
    provider_error = null,
    provider_name = null,
    provider_type = null
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

create or replace function public.admin_retry_failed_order(
  p_admin_id uuid,
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
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_order
  from orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_order.status <> 'failed' then
    return jsonb_build_object('success', false, 'error', 'Only failed orders can be retried');
  end if;

  if v_order.failure_reason = 'insufficient_balance' then
    select wallet_balance into v_balance from profiles where id = v_order.user_id for update;

    if v_balance < v_order.amount then
      return jsonb_build_object(
        'success', false,
        'error', 'User has insufficient balance (GHS ' || v_balance::text || ') for this order'
      );
    end if;

    update profiles
    set wallet_balance = wallet_balance - v_order.amount, updated_at = now()
    where id = v_order.user_id;

    insert into transactions (user_id, type, amount, description, reference)
    values (
      v_order.user_id,
      'debit',
      v_order.amount,
      'Admin retry: ' || v_order.network || ' ' || v_order.size_gb || 'GB -> ' || v_order.phone,
      v_order.reference
    );
  end if;

  select coalesce(nullif(trim(value), '')::integer, 0)
  into v_auto_seconds
  from site_settings where key = 'order_auto_deliver_seconds';

  v_final_status := case when coalesce(v_auto_seconds, 0) <= 0 then 'completed' else 'pending' end;

  update orders
  set
    status = v_final_status,
    failure_reason = null,
    admin_visible = true,
    completed_at = case when v_final_status = 'completed' then now() else null end,
    provider_submitted_at = null,
    provider_status = null,
    provider_reference = null,
    provider_order_number = null,
    provider_error = null,
    provider_name = null,
    provider_type = null
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'status', v_final_status,
      'user_id', v_order.user_id
    )
  );
end;
$func$;

grant execute on function public.admin_retry_failed_order to authenticated;

grant execute on function public.retry_failed_order to authenticated;

grant execute on function public.track_orders_by_phone to authenticated;

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
      'completed_at', o.completed_at,
      'provider_status', o.provider_status,
      'provider_name', o.provider_name,
      'provider_error', o.provider_error,
      'provider_submitted_at', o.provider_submitted_at
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
