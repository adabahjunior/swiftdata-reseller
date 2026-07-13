-- Number verification (Datahub beneficiary check + user request queue)

create table if not exists public.number_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone text not null,
  network text not null default 'mtn',
  status text not null default 'unverified'
    check (status in ('verified', 'unverified', 'pending', 'submitted', 'failed')),
  provider_exists boolean,
  provider_message text,
  provider_name text,
  note text,
  checked_at timestamptz,
  requested_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, phone)
);

create index if not exists idx_number_verifications_user
  on public.number_verifications(user_id, updated_at desc);

create index if not exists idx_number_verifications_status
  on public.number_verifications(status, requested_at desc nulls last)
  where status in ('pending', 'submitted');

alter table public.number_verifications enable row level security;

drop policy if exists "Users read own number verifications" on public.number_verifications;
create policy "Users read own number verifications"
  on public.number_verifications for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users insert own number verifications" on public.number_verifications;
create policy "Users insert own number verifications"
  on public.number_verifications for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own number verifications" on public.number_verifications;
create policy "Users update own number verifications"
  on public.number_verifications for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- Request verification for an unverified (or re-check failed) number
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

  if v_phone !~ '^0[2-5][0-9]{8}$' then
    return jsonb_build_object('success', false, 'error', 'Invalid Ghana phone number');
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

grant execute on function public.request_number_verification to authenticated;

-- Admin update verification request status
create or replace function public.admin_update_number_verification(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.number_verifications%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin only');
  end if;

  if p_status not in ('verified', 'unverified', 'pending', 'submitted', 'failed') then
    return jsonb_build_object('success', false, 'error', 'Invalid status');
  end if;

  update number_verifications set
    status = p_status,
    note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
    resolved_at = case when p_status in ('verified', 'failed', 'unverified') then now() else resolved_at end,
    resolved_by = case when p_status in ('verified', 'failed', 'unverified') then auth.uid() else resolved_by end,
    updated_at = now()
  where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Not found');
  end if;

  return jsonb_build_object('success', true, 'record', to_jsonb(v_row));
end;
$$;

grant execute on function public.admin_update_number_verification to authenticated;
