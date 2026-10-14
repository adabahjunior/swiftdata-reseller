-- MTN MashUp: one 30-day package of data + MTN minutes + other-network minutes + SMS,
-- sold to users (dashboard + API) and fulfilled through DataMart's /mashup endpoints.

alter table public.orders drop constraint if exists orders_service_type_check;
alter table public.orders
  add constraint orders_service_type_check
  check (service_type in ('data', 'airtime', 'ecg', 'tv', 'mashup'));

create table if not exists public.mashup_packages (
  id uuid primary key default gen_random_uuid(),
  combo_cost integer not null unique,
  code text generated always as ('MASHUP' || combo_cost::text) stored,
  title text not null,
  price numeric(12, 2) not null,
  cost_price numeric(12, 2) not null,
  mb integer not null default 0,
  capacity numeric(8, 2) not null default 0,
  onnet_mins integer not null default 0,
  offnet_mins integer not null default 0,
  sms integer not null default 0,
  validity_days integer not null default 30,
  active boolean not null default true,
  available boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.mashup_packages.combo_cost is 'DataMart comboCost: names the package when buying, not a price';
comment on column public.mashup_packages.price is 'What our users pay';
comment on column public.mashup_packages.cost_price is 'What DataMart charges us (per account tier)';
comment on column public.mashup_packages.available is 'Still listed in the DataMart catalogue at the last sync';

create unique index if not exists idx_mashup_packages_code on public.mashup_packages(code);

alter table public.mashup_packages enable row level security;

-- Users read packages through get_mashup_packages() so cost_price stays private.
drop policy if exists "Admins manage mashup packages" on public.mashup_packages;
create policy "Admins manage mashup packages"
  on public.mashup_packages for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.orders
  add column if not exists mashup_package_id uuid references public.mashup_packages(id);

create index if not exists idx_orders_mashup_pending
  on public.orders(created_at asc)
  where service_type = 'mashup' and provider_submitted_at is null;

insert into public.site_settings (key, value, label) values
  ('mashup_enabled', 'false', 'Sell MTN MashUp packages (DataMart must enable MashUp on the account)'),
  ('mashup_api_key', '', 'DataMart API key used for MTN MashUp'),
  ('mashup_lane_open', 'true', 'DataMart MashUp lane open (updated automatically)'),
  ('mashup_lane_note', '', 'Why the MashUp lane is closed (internal)'),
  ('mashup_pricing_tier', '', 'DataMart pricing tier at the last catalogue sync'),
  ('mashup_provider_balance', '', 'DataMart wallet balance at the last check (GHS)'),
  ('mashup_catalog_synced_at', '', 'Last MashUp catalogue sync (internal)'),
  ('mashup_lane_checked_at', '', 'Last automatic MashUp lane re-check (internal)'),
  ('mashup_status_sync_last_at', '', 'Last MashUp order status sync (internal)')
on conflict (key) do nothing;

drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
  on public.site_settings for select to authenticated
  using (
    public.is_admin()
    or key not in (
      'data_provider_primary_api_key',
      'data_provider_secondary_api_key',
      'data_provider_tertiary_api_key',
      'data_provider_quaternary_api_key',
      'data_provider_quinary_api_key',
      'datamart_api_key',
      'mashup_api_key',
      'mashup_provider_balance',
      'datahub_webhook_secret',
      'bundlezone_webhook_secret',
      'spendless_webhook_secret',
      'sms_api_key',
      'xcel_pin',
      'xcel_hmac_secret',
      'xcel_api_key'
    )
  );

create or replace function public.get_mashup_packages()
returns table (
  id uuid,
  code text,
  title text,
  price numeric,
  mb integer,
  capacity numeric,
  onnet_mins integer,
  offnet_mins integer,
  sms integer,
  validity_days integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.code, p.title, p.price, p.mb, p.capacity, p.onnet_mins, p.offnet_mins, p.sms, p.validity_days
  from mashup_packages p
  where p.active and p.available
  order by p.price, p.combo_cost;
$$;

grant execute on function public.get_mashup_packages() to authenticated, service_role;

-- Shared by the dashboard and API entry points; never callable directly by clients.
create or replace function public.create_mashup_order(
  p_user_id uuid,
  p_package_id uuid,
  p_package_code text,
  p_phone text,
  p_source text,
  p_api_key_id uuid default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pkg record;
  v_profile record;
  v_phone text;
  v_ref text;
  v_balance numeric;
  v_order_id uuid;
  v_meta jsonb;
  v_label text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\s', '', 'g');
  if v_phone ~ '^233[0-9]{9}$' then
    v_phone := '0' || substr(v_phone, 4);
  end if;
  if v_phone !~ '^0(24|25|53|54|55|59)[0-9]{7}$' then
    return jsonb_build_object('success', false, 'error', 'Invalid MTN number. Use 024, 025, 053, 054, 055 or 059 e.g. 0241234567');
  end if;

  select is_active, api_enabled into v_profile from profiles where id = p_user_id;
  if not found or not v_profile.is_active then
    return jsonb_build_object('success', false, 'error', 'Account is deactivated');
  end if;

  if p_source = 'api' then
    if not coalesce(v_profile.api_enabled, true) then
      return jsonb_build_object('success', false, 'error', 'API access disabled for this account');
    end if;
    if coalesce((select value from site_settings where key = 'api_enabled'), 'true') = 'false' then
      return jsonb_build_object('success', false, 'error', 'API is temporarily disabled');
    end if;
  end if;

  if coalesce((select value from site_settings where key = 'maintenance_mode'), 'false') = 'true' then
    return jsonb_build_object('success', false, 'error', 'Platform is in maintenance mode');
  end if;

  if coalesce((select value from site_settings where key = 'mashup_enabled'), 'false') <> 'true' then
    return jsonb_build_object('success', false, 'error', 'MTN MashUp is not available yet');
  end if;

  if coalesce((select value from site_settings where key = 'mashup_lane_open'), 'true') = 'false' then
    return jsonb_build_object('success', false, 'error', 'MTN MashUp is temporarily unavailable. Please try again later.');
  end if;

  select * into v_pkg
  from mashup_packages
  where active and available
    and (
      (p_package_id is not null and id = p_package_id)
      or (p_package_id is null and upper(code) = upper(trim(coalesce(p_package_code, ''))))
    )
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Unknown or unavailable MashUp package. Use GET /v1/mashup-packages for valid package codes.');
  end if;

  if v_pkg.price < v_pkg.cost_price then
    return jsonb_build_object('success', false, 'error', 'This package is being repriced. Please try again shortly.');
  end if;

  v_ref := nullif(trim(coalesce(p_reference, '')), '');
  if v_ref is not null then
    if length(v_ref) > 64 or v_ref !~ '^[A-Za-z0-9_.:-]+$' then
      return jsonb_build_object('success', false, 'error', 'reference may only contain letters, numbers, - _ . : (max 64)');
    end if;
    if exists (select 1 from orders where reference = v_ref) then
      return jsonb_build_object('success', false, 'error', 'Duplicate reference. Each order needs a unique reference.');
    end if;
  else
    v_ref := 'MSH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;

  v_meta := jsonb_build_object(
    'package_code', v_pkg.code,
    'combo_cost', v_pkg.combo_cost,
    'title', v_pkg.title,
    'mb', v_pkg.mb,
    'capacity', v_pkg.capacity,
    'onnet_mins', v_pkg.onnet_mins,
    'offnet_mins', v_pkg.offnet_mins,
    'sms', v_pkg.sms,
    'validity_days', v_pkg.validity_days
  );
  v_label := case when p_source = 'api' then 'API ' else '' end || v_pkg.title || ' -> ' || v_phone;

  select wallet_balance into v_balance from profiles where id = p_user_id for update;

  if v_balance < v_pkg.price then
    insert into orders (
      user_id, reference, phone, network, package_id, size_gb, amount,
      status, failure_reason, admin_visible, order_source, api_key_id,
      service_type, mashup_package_id, utility_meta
    ) values (
      p_user_id, v_ref, v_phone, 'mtn', null, 0, v_pkg.price,
      'failed', 'insufficient_balance', false, p_source, p_api_key_id,
      'mashup', v_pkg.id, v_meta
    )
    returning id into v_order_id;

    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient API balance',
      'order', jsonb_build_object('id', v_order_id, 'reference', v_ref, 'status', 'failed')
    );
  end if;

  update profiles set wallet_balance = wallet_balance - v_pkg.price, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, admin_visible, order_source, api_key_id,
    service_type, mashup_package_id, utility_meta
  ) values (
    p_user_id, v_ref, v_phone, 'mtn', null, 0, v_pkg.price,
    'pending', true, p_source, p_api_key_id,
    'mashup', v_pkg.id, v_meta
  )
  returning id into v_order_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (p_user_id, 'debit', v_pkg.price, v_label, v_ref);

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'reference', v_ref,
      'service_type', 'mashup',
      'phone', v_phone,
      'amount', v_pkg.price,
      'status', 'pending',
      'created_at', now(),
      'utility_meta', v_meta
    )
  );
end;
$func$;

revoke all on function public.create_mashup_order(uuid, uuid, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.dashboard_place_mashup_order(
  p_user_id uuid,
  p_package_id uuid,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;
  return public.create_mashup_order(p_user_id, p_package_id, null, p_phone, 'dashboard');
end;
$func$;

revoke all on function public.dashboard_place_mashup_order(uuid, uuid, text) from public, anon;
grant execute on function public.dashboard_place_mashup_order(uuid, uuid, text) to authenticated;

create or replace function public.api_buy_mashup(
  p_user_id uuid,
  p_api_key_id uuid,
  p_package_code text,
  p_phone text,
  p_reference text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.create_mashup_order(p_user_id, null, p_package_code, p_phone, 'api', p_api_key_id, p_reference);
$$;

revoke all on function public.api_buy_mashup(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.api_buy_mashup(uuid, uuid, text, text, text) to service_role;

create or replace function public.get_orders_pending_mashup(p_limit integer default 20)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select *
  from orders
  where service_type = 'mashup'
    and provider_submitted_at is null
    and admin_visible = true
    and status in ('pending', 'processing', 'completed')
    and coalesce((select value from site_settings where key = 'mashup_enabled'), 'false') = 'true'
  order by created_at asc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.get_orders_pending_mashup(integer) from public, anon, authenticated;
grant execute on function public.get_orders_pending_mashup(integer) to service_role;

-- Credit the wallet back once DataMart has definitively not delivered (it refunds us too).
create or replace function public.refund_mashup_order(p_order_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_order record;
begin
  update orders
  set status = 'failed',
      failure_reason = 'refunded',
      provider_status = 'failed',
      provider_error = left(p_reason, 500),
      completed_at = null
  where id = p_order_id
    and service_type = 'mashup'
    and coalesce(failure_reason, '') not in ('refunded', 'insufficient_balance')
  returning user_id, amount, reference into v_order;

  if not found then
    return false;
  end if;

  update profiles set wallet_balance = wallet_balance + v_order.amount, updated_at = now()
  where id = v_order.user_id;

  insert into transactions (user_id, type, amount, description, reference)
  values (v_order.user_id, 'credit', v_order.amount, 'Refund: MTN MashUp not delivered (' || v_order.reference || ')', v_order.reference);

  return true;
end;
$func$;

revoke all on function public.refund_mashup_order(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_mashup_order(uuid, text) to service_role;

-- The data-provider status poll must not touch MashUp orders (they use their own key and lane).
create or replace function public.get_orders_pending_provider_status(p_limit integer default 50)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select *
  from orders
  where provider_submitted_at is not null
    and provider_status in ('submitted', 'processing')
    and status in ('pending', 'processing')
    and coalesce(service_type, 'data') = 'data'
    and coalesce(
      (select value from site_settings where key = 'provider_status_sync_enabled' limit 1),
      'true'
    ) = 'true'
  order by provider_submitted_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_orders_pending_provider_status to service_role;

-- Retries: refunded MashUp orders are charged again, and non-data orders stay pending
-- until their provider confirms delivery.

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

  if v_order.failure_reason in ('insufficient_balance', 'refunded') then
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
      'Admin retry: ' || coalesce(v_order.utility_meta->>'title', v_order.network || ' ' || coalesce(v_order.size_gb::text, '0') || 'GB') || ' -> ' || v_order.phone,
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

  v_final_status := case
    when coalesce(v_order.service_type, 'data') = 'data' and coalesce(v_auto_seconds, 0) <= 0 then 'completed'
    else 'pending'
  end;

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

  if v_order.failure_reason in ('insufficient_balance', 'refunded') then
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
      'Retry: ' || coalesce(v_order.utility_meta->>'title', v_order.network || ' ' || v_order.size_gb || 'GB') || ' -> ' || v_order.phone,
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

  v_final_status := case
    when coalesce(v_order.service_type, 'data') = 'data' and coalesce(v_auto_seconds, 0) <= 0 then 'completed'
    else 'pending'
  end;

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