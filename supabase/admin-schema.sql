-- Admin privileges and platform management tables

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  label text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'warning', 'success', 'error')),
  is_active boolean not null default true,
  target text not null default 'all' check (target in ('all', 'users', 'admins')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.site_settings enable row level security;
alter table public.notifications enable row level security;

-- Admin read/update all profiles (existing own-profile policies remain)
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin() or auth.uid() = id);

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update to authenticated
  using (public.is_admin() or auth.uid() = id);

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- Admin orders access
drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select to authenticated
  using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "Admins can update all orders" on public.orders;
create policy "Admins can update all orders"
  on public.orders for update to authenticated
  using (public.is_admin());

drop policy if exists "Users view own orders" on public.orders;

-- Admin packages management
drop policy if exists "Authenticated users can view active packages" on public.data_packages;
create policy "Anyone authenticated can view packages"
  on public.data_packages for select to authenticated
  using (active = true or public.is_admin());

drop policy if exists "Admins manage packages" on public.data_packages;
create policy "Admins manage packages"
  on public.data_packages for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Admin transactions view
drop policy if exists "Admins can view all transactions" on public.transactions;
create policy "Admins can view all transactions"
  on public.transactions for select to authenticated
  using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "Users view own transactions" on public.transactions;

-- Admin api logs
drop policy if exists "Admins can view all api logs" on public.api_logs;
create policy "Admins can view all api logs"
  on public.api_logs for select to authenticated
  using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "Users view own api logs" on public.api_logs;

-- Site settings
drop policy if exists "Authenticated users can read site settings" on public.site_settings;
create policy "Authenticated users can read site settings"
  on public.site_settings for select to authenticated
  using (true);

drop policy if exists "Admins manage site settings" on public.site_settings;
create policy "Admins manage site settings"
  on public.site_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Notifications
drop policy if exists "Users read active notifications" on public.notifications;
create policy "Users read active notifications"
  on public.notifications for select to authenticated
  using (
    public.is_admin()
    or (
      is_active = true
      and (expires_at is null or expires_at > now())
      and target in ('all', 'users')
    )
  );

drop policy if exists "Admins manage notifications" on public.notifications;
create policy "Admins manage notifications"
  on public.notifications for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Seed default site settings
insert into public.site_settings (key, value, label) values
  ('site_name', 'SwiftData Reseller', 'Site Name'),
  ('support_email', 'support@scqeel.com', 'Support Email'),
  ('support_phone', '0240000000', 'Support Phone'),
  ('maintenance_mode', 'false', 'Maintenance Mode'),
  ('api_enabled', 'true', 'API Enabled'),
  ('min_topup_amount', '10', 'Minimum Top-up (GHS)'),
  ('platform_notice', 'Welcome to SwiftData Reseller API Platform', 'Platform Notice')
on conflict (key) do nothing;
