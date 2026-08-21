-- Support tickets + agent customers/analytics RPCs

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_reference text,
  subject text not null,
  body text not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  admin_feedback text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user on public.support_tickets(user_id, created_at desc);
create index if not exists idx_support_tickets_status on public.support_tickets(status, created_at desc);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  is_admin_reply boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_ticket_messages_ticket
  on public.support_ticket_messages(ticket_id, created_at asc);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists "Users read own tickets" on public.support_tickets;
create policy "Users read own tickets"
  on public.support_tickets for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users create own tickets" on public.support_tickets;
create policy "Users create own tickets"
  on public.support_tickets for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own open tickets" on public.support_tickets;
create policy "Users update own open tickets"
  on public.support_tickets for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users read ticket messages" on public.support_ticket_messages;
create policy "Users read ticket messages"
  on public.support_ticket_messages for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "Users insert ticket messages" on public.support_ticket_messages;
create policy "Users insert ticket messages"
  on public.support_ticket_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      (is_admin_reply = false and exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id and t.user_id = auth.uid()
      ))
      or (is_admin_reply = true and public.is_admin())
    )
  );

create or replace function public.touch_support_ticket_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.touch_support_ticket_updated_at();

-- Returning customers = beneficiary phones with 2+ completed/paid orders for this agent
create or replace function public.get_agent_customers(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_rows jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_uid is distinct from auth.uid() and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.order_count desc, x.last_order_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      o.phone,
      count(*)::integer as order_count,
      coalesce(sum(o.amount) filter (where o.status = 'completed'), 0)::numeric as total_spent,
      min(o.created_at) as first_order_at,
      max(o.created_at) as last_order_at,
      count(*) filter (where o.status = 'completed')::integer as completed_count,
      count(*) filter (where o.status = 'failed')::integer as failed_count,
      mode() within group (order by o.network) as top_network,
      (count(*) >= 2) as is_returning
    from public.orders o
    where o.user_id = v_uid
      and o.admin_visible = true
    group by o.phone
  ) x;

  return jsonb_build_object(
    'success', true,
    'customers', v_rows,
    'returning_count', (
      select count(*)::integer from jsonb_array_elements(v_rows) c
      where (c->>'is_returning')::boolean
    ),
    'total_count', jsonb_array_length(v_rows)
  );
end;
$func$;

create or replace function public.get_agent_analytics(p_user_id uuid default null, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_days integer := greatest(coalesce(p_days, 30), 1);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_orders jsonb;
  v_tx jsonb;
  v_daily jsonb;
  v_networks jsonb;
  v_customers jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_uid is distinct from auth.uid() and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select jsonb_build_object(
    'total', count(*)::integer,
    'completed', count(*) filter (where status = 'completed')::integer,
    'pending', count(*) filter (where status in ('pending', 'processing'))::integer,
    'failed', count(*) filter (where status = 'failed')::integer,
    'revenue', coalesce(sum(amount) filter (where status = 'completed'), 0),
    'spend', coalesce(sum(amount), 0),
    'period_orders', count(*) filter (where created_at >= v_since)::integer,
    'period_revenue', coalesce(sum(amount) filter (where status = 'completed' and created_at >= v_since), 0)
  )
  into v_orders
  from public.orders
  where user_id = v_uid and admin_visible = true;

  select jsonb_build_object(
    'credits', coalesce(sum(amount) filter (where type = 'credit'), 0),
    'debits', coalesce(sum(amount) filter (where type = 'debit'), 0),
    'period_credits', coalesce(sum(amount) filter (where type = 'credit' and created_at >= v_since), 0),
    'period_debits', coalesce(sum(amount) filter (where type = 'debit' and created_at >= v_since), 0),
    'tx_count', count(*)::integer
  )
  into v_tx
  from public.transactions
  where user_id = v_uid;

  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
  into v_daily
  from (
    select
      date_trunc('day', created_at at time zone 'Africa/Accra')::date as day,
      count(*)::integer as orders,
      coalesce(sum(amount) filter (where status = 'completed'), 0)::numeric as revenue,
      count(*) filter (where status = 'completed')::integer as completed,
      count(*) filter (where status = 'failed')::integer as failed
    from public.orders
    where user_id = v_uid
      and admin_visible = true
      and created_at >= v_since
    group by 1
  ) d;

  select coalesce(jsonb_agg(row_to_json(n)::jsonb order by n.revenue desc), '[]'::jsonb)
  into v_networks
  from (
    select
      network,
      count(*)::integer as orders,
      coalesce(sum(amount) filter (where status = 'completed'), 0)::numeric as revenue
    from public.orders
    where user_id = v_uid
      and admin_visible = true
      and created_at >= v_since
    group by network
  ) n;

  select jsonb_build_object(
    'unique_phones', count(distinct phone)::integer,
    'returning_phones', count(*) filter (where cnt >= 2)::integer,
    'new_phones', count(*) filter (where cnt = 1)::integer
  )
  into v_customers
  from (
    select phone, count(*) as cnt
    from public.orders
    where user_id = v_uid and admin_visible = true
    group by phone
  ) c;

  return jsonb_build_object(
    'success', true,
    'days', v_days,
    'since', v_since,
    'wallet_balance', (select wallet_balance from profiles where id = v_uid),
    'orders', v_orders,
    'transactions', v_tx,
    'daily', v_daily,
    'networks', v_networks,
    'customers', v_customers
  );
end;
$func$;

create or replace function public.admin_update_ticket(
  p_admin_id uuid,
  p_ticket_id uuid,
  p_status text default null,
  p_feedback text default null,
  p_reply text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_ticket public.support_tickets%rowtype;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_ticket from support_tickets where id = p_ticket_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Ticket not found');
  end if;

  update support_tickets
  set
    status = coalesce(nullif(trim(p_status), ''), status),
    admin_feedback = case
      when p_feedback is null then admin_feedback
      else nullif(trim(p_feedback), '')
    end,
    resolved_at = case
      when coalesce(nullif(trim(p_status), ''), status) in ('resolved', 'closed') then coalesce(resolved_at, now())
      else resolved_at
    end,
    resolved_by = case
      when coalesce(nullif(trim(p_status), ''), status) in ('resolved', 'closed') then p_admin_id
      else resolved_by
    end,
    updated_at = now()
  where id = p_ticket_id
  returning * into v_ticket;

  if p_reply is not null and length(trim(p_reply)) > 0 then
    insert into support_ticket_messages (ticket_id, author_id, body, is_admin_reply)
    values (p_ticket_id, p_admin_id, trim(p_reply), true);
  end if;

  return jsonb_build_object('success', true, 'ticket', row_to_json(v_ticket));
end;
$func$;

grant execute on function public.get_agent_customers(uuid) to authenticated;
grant execute on function public.get_agent_analytics(uuid, integer) to authenticated;
grant execute on function public.admin_update_ticket(uuid, uuid, text, text, text) to authenticated;

alter table public.support_tickets replica identity full;
alter table public.support_ticket_messages replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.support_tickets;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.support_ticket_messages;
exception
  when duplicate_object then null;
end $$;
