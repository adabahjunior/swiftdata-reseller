-- Data packages available via API
create table if not exists public.data_packages (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network in ('mtn', 'at_ishare', 'at_bigtime', 'telecel')),
  size_gb numeric(6, 2) not null,
  price numeric(12, 2) not null,
  validity text not null default 'Non expiry',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- User API keys
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Default Key',
  key_value text not null unique,
  key_prefix text not null,
  is_active boolean not null default true,
  requests_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Orders placed via API
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reference text not null unique,
  phone text not null,
  network text not null,
  package_id uuid references public.data_packages(id) on delete set null,
  size_gb numeric(6, 2) not null,
  amount numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  api_key_id uuid references public.api_keys(id) on delete set null,
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Balance transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(12, 2) not null,
  description text not null,
  reference text,
  created_at timestamptz not null default now()
);

-- API request logs for health monitoring
create table if not exists public.api_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  endpoint text not null,
  method text not null default 'POST',
  status_code integer not null,
  response_time_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_api_keys_user_id on public.api_keys(user_id);
create index if not exists idx_api_logs_user_id on public.api_logs(user_id);
create index if not exists idx_api_logs_created_at on public.api_logs(created_at desc);
create index if not exists idx_transactions_user_id on public.transactions(user_id);

-- RLS
alter table public.data_packages enable row level security;
alter table public.api_keys enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;
alter table public.api_logs enable row level security;

drop policy if exists "Authenticated users can view active packages" on public.data_packages;
create policy "Authenticated users can view active packages"
  on public.data_packages for select to authenticated
  using (active = true);

drop policy if exists "Users manage own api keys" on public.api_keys;
create policy "Users manage own api keys"
  on public.api_keys for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users view own orders" on public.orders;
create policy "Users view own orders"
  on public.orders for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users view own transactions" on public.transactions;
create policy "Users view own transactions"
  on public.transactions for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users view own api logs" on public.api_logs;
create policy "Users view own api logs"
  on public.api_logs for select to authenticated
  using (auth.uid() = user_id);

-- Seed data packages (only if empty)
insert into public.data_packages (network, size_gb, price, validity)
select * from (values
  ('mtn'::text, 1::numeric, 4.50::numeric, 'Non expiry'::text),
  ('mtn', 2, 8.50, 'Non expiry'),
  ('mtn', 5, 20.00, 'Non expiry'),
  ('mtn', 10, 38.00, 'Non expiry'),
  ('at_ishare', 1, 4.00, 'Non expiry'),
  ('at_ishare', 2, 7.50, 'Non expiry'),
  ('at_ishare', 5, 18.00, 'Non expiry'),
  ('at_bigtime', 1, 3.80, 'Non expiry'),
  ('at_bigtime', 2, 7.00, 'Non expiry'),
  ('telecel', 1, 4.20, 'Non expiry'),
  ('telecel', 2, 8.00, 'Non expiry'),
  ('telecel', 5, 19.00, 'Non expiry')
) as seed(network, size_gb, price, validity)
where not exists (select 1 from public.data_packages limit 1);
