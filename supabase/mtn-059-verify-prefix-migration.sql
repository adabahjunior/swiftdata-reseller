-- Allow MTN 059 prefix for number verification submissions

create or replace function public.request_number_verification(
  p_user_id uuid,
  p_phone text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := trim(p_phone);
  v_row public.number_verifications%rowtype;
begin
  if auth.uid() is distinct from p_user_id and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_phone !~ '^0(24|25|53|54|55|59)[0-9]{7}$' then
    return jsonb_build_object(
      'success', false,
      'error', 'Only MTN numbers starting with 024, 025, 053, 054, 055, or 059 are allowed'
    );
  end if;

  select * into v_row
  from number_verifications
  where user_id = p_user_id and phone = v_phone;

  if found and v_row.status = 'verified' then
    return jsonb_build_object('success', true, 'already_verified', true, 'record', to_jsonb(v_row));
  end if;

  if found and v_row.status in ('pending', 'submitted') then
    return jsonb_build_object('success', true, 'already_requested', true, 'record', to_jsonb(v_row));
  end if;

  insert into number_verifications (
    user_id, phone, network, status, note, requested_at, updated_at
  ) values (
    p_user_id,
    v_phone,
    'mtn',
    'pending',
    nullif(trim(coalesce(p_note, '')), ''),
    now(),
    now()
  )
  on conflict (user_id, phone) do update set
    status = 'pending',
    note = coalesce(nullif(trim(coalesce(excluded.note, '')), ''), number_verifications.note),
    requested_at = now(),
    resolved_at = null,
    resolved_by = null,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object('success', true, 'record', to_jsonb(v_row));
end;
$$;

grant execute on function public.request_number_verification(uuid, text, text) to authenticated;
