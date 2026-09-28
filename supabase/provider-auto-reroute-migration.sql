-- Auto re-routing of rejected orders across provider slots, with a per-order attempt log.
-- The unique (order_id, route_round, provider_slot) key guarantees a provider slot is sent
-- a given order at most once per routing round.

alter table public.orders
  add column if not exists provider_route_round integer not null default 0,
  add column if not exists provider_attempt_id uuid,
  add column if not exists provider_attempts integer not null default 0;

create table if not exists public.order_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  route_round integer not null default 0,
  attempt_no integer not null,
  provider_slot text not null,
  provider_type text not null,
  provider_name text not null,
  outcome text not null default 'submitting'
    check (outcome in ('submitting', 'accepted', 'rejected', 'uncertain', 'failed_later')),
  http_status integer,
  provider_reference text,
  provider_order_number text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (order_id, route_round, provider_slot)
);

create index if not exists idx_order_provider_attempts_order
  on public.order_provider_attempts(order_id, route_round, attempt_no);

alter table public.order_provider_attempts enable row level security;

drop policy if exists "Admins can read provider attempts" on public.order_provider_attempts;
create policy "Admins can read provider attempts"
  on public.order_provider_attempts for select to authenticated
  using (public.is_admin());

insert into public.site_settings (key, value, label) values
  ('provider_auto_reroute_enabled', 'true', 'Automatically re-send rejected orders to the next provider'),
  ('provider_reroute_chain', 'primary,secondary,tertiary,quaternary', 'Fallback order of provider slots for auto re-routing')
on conflict (key) do nothing;

-- Admin retry starts a fresh routing round so every provider can be tried again.
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
      'failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected', 'uncertain'
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

grant execute on function public.admin_retry_failed_order to authenticated;
