-- Failed insufficient-balance orders hidden from admin until user retries successfully

alter table public.orders
  add column if not exists admin_visible boolean not null default true;

create index if not exists idx_orders_admin_visible on public.orders(admin_visible) where admin_visible = true;

drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select to authenticated
  using (auth.uid() = user_id or (public.is_admin() and admin_visible = true));

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

  update profiles set wallet_balance = wallet_balance - v_pkg.price, updated_at = now()
  where id = p_user_id;

  insert into orders (
    user_id, reference, phone, network, package_id, size_gb, amount,
    status, api_key_id, admin_visible
  )
  values (
    p_user_id, v_ref, p_phone, v_pkg.network, v_pkg.id, v_pkg.size_gb, v_pkg.price,
    'processing', p_api_key_id, true
  )
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
    status = 'completed',
    failure_reason = null,
    admin_visible = true,
    completed_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'status', 'completed'
    )
  );
end;
$func$;

grant execute on function public.retry_failed_order to authenticated;

-- Only export admin-visible orders
create or replace function public.admin_create_order_export(p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_order_ids uuid[];
  v_count integer;
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_download_id uuid;
  v_label text;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select array_agg(id order by created_at asc),
         count(*)::integer,
         min(created_at),
         max(created_at)
  into v_order_ids, v_count, v_first_at, v_last_at
  from (
    select id, created_at
    from orders
    where export_download_id is null
      and admin_visible = true
    order by created_at asc
    limit 50
  ) sub;

  if v_count is null or v_count = 0 then
    return jsonb_build_object('success', false, 'error', 'No unexported orders available');
  end if;

  v_label := 'orders-export-' || to_char(now(), 'YYYY-MM-DD') || '-batch-' ||
    (select coalesce(count(*), 0) + 1 from order_export_downloads);

  insert into order_export_downloads (
    order_ids, order_count, first_order_at, last_order_at, downloaded_by, file_label
  )
  values (v_order_ids, v_count, v_first_at, v_last_at, p_admin_id, v_label)
  returning id into v_download_id;

  update orders
  set export_download_id = v_download_id
  where id = any(v_order_ids);

  return jsonb_build_object(
    'success', true,
    'download_id', v_download_id,
    'order_ids', to_jsonb(v_order_ids),
    'order_count', v_count,
    'file_label', v_label
  );
end;
$func$;
