-- Allow admins to deduct user wallet balance (with ledger entry)

create or replace function public.admin_debit_wallet(
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

  if v_profile.wallet_balance < p_amount then
    return jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance. Current balance: ' || v_profile.wallet_balance::text
    );
  end if;

  v_new_balance := v_profile.wallet_balance - p_amount;

  update profiles
  set wallet_balance = v_new_balance, updated_at = now()
  where id = v_target_id;

  v_ref := 'DEBIT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into transactions (user_id, type, amount, description, reference)
  values (
    v_target_id,
    'debit',
    p_amount,
    coalesce(p_note, 'Wallet deducted by admin'),
    v_ref
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

grant execute on function public.admin_debit_wallet to authenticated;
