-- Admin SMS blasts via TXTConnect, plus atomic outbox claiming so a message is never sent twice

create table if not exists public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  message text not null,
  audience text not null check (audience in ('all', 'active', 'api', 'custom')),
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.sms_campaigns enable row level security;

drop policy if exists "Admins view sms campaigns" on public.sms_campaigns;
create policy "Admins view sms campaigns"
  on public.sms_campaigns for select to authenticated
  using (public.is_admin());

alter table public.sms_outbox
  add column if not exists campaign_id uuid references public.sms_campaigns(id) on delete set null;

create index if not exists idx_sms_outbox_campaign
  on public.sms_outbox(campaign_id)
  where campaign_id is not null;

alter table public.sms_outbox drop constraint if exists sms_outbox_status_check;
alter table public.sms_outbox
  add constraint sms_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- Claim rows before sending: concurrent dispatchers never pick the same message.
-- Notifications go ahead of blast messages.
drop function if exists public.get_pending_sms_outbox(integer);
create function public.get_pending_sms_outbox(p_limit integer default 30)
returns setof public.sms_outbox
language sql
volatile
security definer
set search_path = public
as $$
  update sms_outbox
  set status = 'sending'
  where id in (
    select id
    from sms_outbox
    where status = 'pending'
    order by (campaign_id is not null), created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning *;
$$;

grant execute on function public.get_pending_sms_outbox to service_role;

create or replace function public.sms_blast_recipients(p_audience text, p_numbers text[])
returns table (user_id uuid, phone text, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  with profile_rows as (
    select p.id, public.normalize_ghana_sms_phone(p.phone) as phone, p.full_name
    from profiles p
    where p_audience in ('all', 'active', 'api')
      and (p_audience <> 'active' or coalesce(p.is_active, true))
      and (p_audience <> 'api' or coalesce(p.api_enabled, false))
  ),
  custom_rows as (
    select null::uuid as id, public.normalize_ghana_sms_phone(n) as phone, null::text as full_name
    from unnest(coalesce(p_numbers, '{}'::text[])) as n
  ),
  combined as (
    select id, phone, full_name from profile_rows where phone is not null
    union all
    select id, phone, full_name from custom_rows where phone is not null
  )
  select distinct on (phone) id, phone, full_name
  from combined
  order by phone, id nulls last;
$$;

revoke execute on function public.sms_blast_recipients(text, text[]) from public, anon, authenticated;

create or replace function public.admin_sms_blast_preview(p_audience text, p_numbers text[] default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_recipients integer;
  v_invalid integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select count(*) into v_recipients from public.sms_blast_recipients(p_audience, p_numbers);

  select count(*) into v_invalid
  from unnest(coalesce(p_numbers, '{}'::text[])) as n
  where trim(n) <> '' and public.normalize_ghana_sms_phone(n) is null;

  return jsonb_build_object('success', true, 'recipients', v_recipients, 'invalid_numbers', v_invalid);
end;
$func$;

create or replace function public.admin_create_sms_blast(
  p_message text,
  p_audience text,
  p_numbers text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_message text := trim(coalesce(p_message, ''));
  v_id uuid;
  v_count integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_message = '' then
    return jsonb_build_object('success', false, 'error', 'Message is empty');
  end if;

  if length(v_message) > 918 then
    return jsonb_build_object('success', false, 'error', 'Message is longer than 918 characters (6 SMS parts)');
  end if;

  if p_audience not in ('all', 'active', 'api', 'custom') then
    return jsonb_build_object('success', false, 'error', 'Unknown audience');
  end if;

  insert into sms_campaigns (created_by, message, audience)
  values (auth.uid(), v_message, p_audience)
  returning id into v_id;

  insert into sms_outbox (user_id, phone, message, event_type, meta, status, campaign_id)
  select
    r.user_id,
    r.phone,
    replace(v_message, '{name}', coalesce(nullif(split_part(trim(coalesce(r.full_name, '')), ' ', 1), ''), 'Customer')),
    'blast',
    jsonb_build_object('campaign_id', v_id),
    'pending',
    v_id
  from public.sms_blast_recipients(p_audience, p_numbers) r;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    delete from sms_campaigns where id = v_id;
    return jsonb_build_object('success', false, 'error', 'No valid recipients');
  end if;

  update sms_campaigns set recipient_count = v_count where id = v_id;

  return jsonb_build_object('success', true, 'campaign_id', v_id, 'recipients', v_count);
end;
$func$;

create or replace function public.admin_cancel_sms_blast(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_count integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  update sms_outbox
  set status = 'skipped', error = 'Cancelled by admin'
  where campaign_id = p_campaign_id and status = 'pending';

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'cancelled', v_count);
end;
$func$;

create or replace function public.admin_sms_campaigns(p_limit integer default 50)
returns table (
  id uuid,
  message text,
  audience text,
  recipient_count integer,
  created_at timestamptz,
  created_by_name text,
  pending bigint,
  sending bigint,
  sent bigint,
  failed bigint,
  skipped bigint,
  top_error text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.message,
    c.audience,
    c.recipient_count,
    c.created_at,
    coalesce(p.full_name, p.email) as created_by_name,
    count(o.id) filter (where o.status = 'pending'),
    count(o.id) filter (where o.status = 'sending'),
    count(o.id) filter (where o.status = 'sent'),
    count(o.id) filter (where o.status = 'failed'),
    count(o.id) filter (where o.status = 'skipped'),
    (
      select e.error
      from sms_outbox e
      where e.campaign_id = c.id and e.status = 'failed' and e.error is not null
      group by e.error
      order by count(*) desc
      limit 1
    )
  from sms_campaigns c
  left join profiles p on p.id = c.created_by
  left join sms_outbox o on o.campaign_id = c.id
  where public.is_admin()
  group by c.id, p.full_name, p.email
  order by c.created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.admin_sms_blast_preview(text, text[]) to authenticated;
grant execute on function public.admin_create_sms_blast(text, text, text[]) to authenticated;
grant execute on function public.admin_cancel_sms_blast(uuid) to authenticated;
grant execute on function public.admin_sms_campaigns(integer) to authenticated;
