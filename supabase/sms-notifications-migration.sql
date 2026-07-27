-- TXTConnect SMS notifications: credit, failed orders, low-balance alerts

alter table public.profiles
  add column if not exists low_balance_threshold numeric(12, 2);

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  phone text not null,
  message text not null,
  event_type text not null,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_sms_outbox_pending
  on public.sms_outbox(created_at asc)
  where status = 'pending';

alter table public.sms_outbox enable row level security;

drop policy if exists "Admins view sms outbox" on public.sms_outbox;
create policy "Admins view sms outbox"
  on public.sms_outbox for select to authenticated
  using (public.is_admin());

insert into public.site_settings (key, value, label) values
  ('sms_enabled', 'true', 'Send SMS notifications via TXTConnect'),
  ('sms_api_key', '', 'TXTConnect API key'),
  ('sms_sender_id', 'OrderInfo', 'TXTConnect sender ID'),
  ('sms_unicode', '0', 'TXTConnect unicode flag (0=regular, 1=unicode)')
on conflict (key) do nothing;

create or replace function public.normalize_ghana_sms_phone(p_phone text)
returns text
language plpgsql
immutable
as $func$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits ~ '^0[2-5][0-9]{8}$' then
    return '233' || substr(v_digits, 2);
  end if;
  if v_digits ~ '^233[2-5][0-9]{8}$' then
    return v_digits;
  end if;
  return null;
end;
$func$;

create or replace function public.enqueue_sms_notification(
  p_user_id uuid,
  p_event_type text,
  p_message text,
  p_meta jsonb default '{}'::jsonb,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_enabled text;
  v_phone text;
  v_id uuid;
begin
  select value into v_enabled from site_settings where key = 'sms_enabled' limit 1;
  if coalesce(v_enabled, 'true') = 'false' then
    return null;
  end if;

  if p_phone is not null and trim(p_phone) <> '' then
    v_phone := public.normalize_ghana_sms_phone(p_phone);
  else
    select public.normalize_ghana_sms_phone(phone)
    into v_phone
    from profiles
    where id = p_user_id;
  end if;

  if v_phone is null then
    insert into sms_outbox (user_id, phone, message, event_type, meta, status, error)
    values (
      p_user_id,
      coalesce(nullif(trim(p_phone), ''), 'unknown'),
      p_message,
      p_event_type,
      p_meta,
      'skipped',
      'No valid Ghana phone on profile'
    )
    returning id into v_id;
    return v_id;
  end if;

  insert into sms_outbox (user_id, phone, message, event_type, meta, status)
  values (p_user_id, v_phone, p_message, p_event_type, coalesce(p_meta, '{}'::jsonb), 'pending')
  returning id into v_id;

  return v_id;
end;
$func$;

create or replace function public.get_pending_sms_outbox(p_limit integer default 30)
returns setof public.sms_outbox
language sql
security definer
set search_path = public
as $$
  select *
  from sms_outbox
  where status = 'pending'
  order by created_at asc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_pending_sms_outbox to service_role;
grant execute on function public.enqueue_sms_notification to service_role;
grant execute on function public.normalize_ghana_sms_phone to authenticated;

-- Failed order SMS (any transition/insert into failed)
create or replace function public.trg_sms_on_failed_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_reason text;
begin
  if new.status is distinct from 'failed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from 'failed' then
    return new;
  end if;

  v_reason := coalesce(nullif(new.failure_reason, ''), nullif(new.provider_error, ''), 'see dashboard');

  perform public.enqueue_sms_notification(
    new.user_id,
    'failed_order',
    'SwiftData: Order ' || new.reference || ' to ' || new.phone || ' (' ||
      new.network || ' ' || new.size_gb::text || 'GB) FAILED. Reason: ' || left(v_reason, 80) ||
      '. Check your dashboard.',
    jsonb_build_object(
      'order_id', new.id,
      'reference', new.reference,
      'failure_reason', new.failure_reason
    )
  );

  return new;
end;
$func$;

drop trigger if exists trg_sms_on_failed_order on public.orders;
create trigger trg_sms_on_failed_order
  after insert or update of status on public.orders
  for each row
  execute function public.trg_sms_on_failed_order();

-- Low balance SMS when crossing threshold downward
create or replace function public.trg_sms_on_low_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.low_balance_threshold is null or new.low_balance_threshold <= 0 then
    return new;
  end if;

  if old.wallet_balance > new.low_balance_threshold
     and new.wallet_balance <= new.low_balance_threshold then
    perform public.enqueue_sms_notification(
      new.id,
      'low_balance',
      'SwiftData: Low balance alert. Your API wallet is GHS ' ||
        trim(to_char(new.wallet_balance, '999999990.99')) ||
        ' (threshold GHS ' || trim(to_char(new.low_balance_threshold, '999999990.99')) ||
        '). Please top up to avoid failed orders.',
      jsonb_build_object(
        'balance', new.wallet_balance,
        'threshold', new.low_balance_threshold
      )
    );
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_sms_on_low_balance on public.profiles;
create trigger trg_sms_on_low_balance
  after update of wallet_balance on public.profiles
  for each row
  execute function public.trg_sms_on_low_balance();

-- Admin credit wallet + SMS
create or replace function public.admin_credit_wallet(
  p_admin_id uuid,
  p_amount numeric,
  p_topup_code text default null,
  p_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_target_id uuid;
  v_profile record;
  v_ref text;
  v_new_balance numeric;
  v_note text;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Amount must be positive');
  end if;

  if p_user_id is not null then
    v_target_id := p_user_id;
  elsif p_topup_code is not null then
    select id into v_target_id from profiles where topup_code = trim(p_topup_code);
    if v_target_id is null then
      return jsonb_build_object('success', false, 'error', 'No user found with topup code ' || p_topup_code);
    end if;
  else
    return jsonb_build_object('success', false, 'error', 'Provide topup_code or user_id');
  end if;

  select * into v_profile from profiles where id = v_target_id for update;

  v_new_balance := v_profile.wallet_balance + p_amount;
  v_note := coalesce(p_note, 'Manual top-up credited by admin');

  update profiles
  set wallet_balance = v_new_balance, updated_at = now()
  where id = v_target_id;

  v_ref := 'CREDIT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into transactions (user_id, type, amount, description, reference)
  values (v_target_id, 'credit', p_amount, v_note, v_ref);

  perform public.enqueue_sms_notification(
    v_target_id,
    'wallet_credit',
    'SwiftData: Your wallet was credited GHS ' || trim(to_char(p_amount, '999999990.99')) ||
      '. New balance: GHS ' || trim(to_char(v_new_balance, '999999990.99')) ||
      '. Ref: ' || v_ref,
    jsonb_build_object(
      'amount', p_amount,
      'new_balance', v_new_balance,
      'reference', v_ref
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', v_target_id,
    'topup_code', v_profile.topup_code,
    'amount', p_amount,
    'new_balance', v_new_balance,
    'reference', v_ref
  );
end;
$func$;

grant execute on function public.admin_credit_wallet to authenticated;
