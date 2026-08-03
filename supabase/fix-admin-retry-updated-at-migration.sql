-- Fix admin retry: orders table has no updated_at column
-- admin_retry_failed_order was failing on UPDATE ... SET updated_at = now()

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
  v_provider_failed boolean;
  v_retryable boolean;
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

  v_provider_failed :=
    lower(coalesce(v_order.provider_status, '')) in (
      'failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected'
    )
    or coalesce(nullif(trim(v_order.provider_error), ''), '') <> '';

  -- Failed orders, or delivered/pending/processing orders rejected by the provider
  v_retryable :=
    v_order.status = 'failed'
    or (
      v_provider_failed
      and v_order.status in ('completed', 'pending', 'processing')
    );

  if not v_retryable then
    return jsonb_build_object(
      'success', false,
      'error', 'Only failed orders or provider-rejected delivered orders can be retried'
    );
  end if;

  -- Only re-charge when the original charge never succeeded
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
      'Admin retry: ' || v_order.network || ' ' || coalesce(v_order.size_gb::text, '0') || 'GB -> ' || v_order.phone,
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
