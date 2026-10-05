-- Stop retries and re-routing from sending the same order twice.
--  * Admin retry asks for confirmation when the order may still be live at a provider
--    (unclear reply, in-flight send, or an accepted attempt that never definitively failed).
--  * Retries mark the previous accepted attempt as superseded and start a new routing round.
--  * Customers cannot retry orders that may still be live; they must contact support.
--  * Hold window for identical orders (same buyer, number, network and bundle).

insert into public.site_settings (key, value, label) values
  ('order_duplicate_hold_minutes', '10', 'Hold identical orders placed within this many minutes for review (0 = off)')
on conflict (key) do nothing;

create or replace function public.order_may_be_live(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select
    lower(coalesce(o.provider_status, '')) not in (
      'failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected', 'refunded', 'reversed'
    )
    and (
      coalesce(o.provider_status, '') <> ''
      or exists (
        select 1 from order_provider_attempts a
        where a.order_id = o.id
          and a.route_round = coalesce(o.provider_route_round, 0)
          and a.outcome in ('accepted', 'uncertain', 'submitting')
      )
    )
  from orders o
  where o.id = p_order_id
$func$;

revoke all on function public.order_may_be_live(uuid) from public, anon, authenticated;

drop function if exists public.admin_retry_failed_order(uuid, uuid);

create or replace function public.admin_retry_failed_order(
  p_admin_id uuid,
  p_order_id uuid,
  p_force boolean default false
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
  if auth.uid() is distinct from p_admin_id and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

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
      'failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected', 'uncertain', 'refunded', 'reversed'
    )
    or coalesce(nullif(trim(v_order.provider_error), ''), '') <> '';

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

  if not p_force and public.order_may_be_live(p_order_id) then
    return jsonb_build_object(
      'success', false,
      'needs_confirmation', true,
      'reference', v_order.reference,
      'error', 'This order may already be with ' || coalesce(v_order.provider_name, 'a provider')
        || ' (' || coalesce(nullif(v_order.provider_status, ''), 'sent') || '). Retrying can deliver it twice.',
      'provider_error', v_order.provider_error
    );
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
      'Admin retry: ' || v_order.network || ' ' || coalesce(v_order.size_gb::text, '0') || 'GB -> ' || v_order.phone,
      v_order.reference
    );
  end if;

  update order_provider_attempts
  set outcome = 'failed_later',
      error = coalesce(error || ' — ', '') || 'Superseded by admin retry',
      finished_at = coalesce(finished_at, now())
  where order_id = p_order_id
    and outcome = 'accepted';

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
    provider_type = null,
    provider_attempt_id = null,
    provider_route_round = provider_route_round + 1
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

revoke all on function public.admin_retry_failed_order(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_retry_failed_order(uuid, uuid, boolean) to authenticated;

create or replace function public.retry_failed_order(p_user_id uuid, p_order_id uuid)
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
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

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

  if public.order_may_be_live(p_order_id) then
    return jsonb_build_object(
      'success', false,
      'error', 'This order is still being checked with the network provider. Please contact support instead of retrying.'
    );
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

  update order_provider_attempts
  set outcome = 'failed_later',
      error = coalesce(error || ' — ', '') || 'Superseded by customer retry',
      finished_at = coalesce(finished_at, now())
  where order_id = p_order_id
    and outcome = 'accepted';

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
    provider_type = null,
    provider_attempt_id = null,
    provider_route_round = provider_route_round + 1
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

revoke all on function public.retry_failed_order(uuid, uuid) from public, anon;
grant execute on function public.retry_failed_order(uuid, uuid) to authenticated;

-- Unclear replies used to copy the provider's ids onto the order; SK Plug's "duplicate order"
-- reply carries another order's id, so clear them (they remain on the attempt rows).
update orders
set provider_reference = null, provider_order_number = null
where lower(coalesce(provider_status, '')) = 'uncertain'
  and (provider_reference is not null or provider_order_number is not null);

-- Earlier admin retries left the previous provider's attempt marked accepted.
update order_provider_attempts a
set outcome = 'failed_later',
    error = coalesce(a.error || ' — ', '') || 'Superseded by admin retry',
    finished_at = coalesce(a.finished_at, now())
from orders o
where o.id = a.order_id
  and a.outcome = 'accepted'
  and a.id is distinct from o.provider_attempt_id
  and a.route_round < coalesce(o.provider_route_round, 0);
