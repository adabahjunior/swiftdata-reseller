-- Dashboard overview carousel banners (admin-uploaded images)

create table if not exists public.dashboard_banners (
  id uuid primary key default gen_random_uuid(),
  title text,
  image_path text not null,
  link_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dashboard_banners_active_order
  on public.dashboard_banners (is_active, sort_order asc, created_at desc);

alter table public.dashboard_banners enable row level security;

drop policy if exists "Authenticated users read active banners" on public.dashboard_banners;
create policy "Authenticated users read active banners"
  on public.dashboard_banners for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists "Admins insert banners" on public.dashboard_banners;
create policy "Admins insert banners"
  on public.dashboard_banners for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins update banners" on public.dashboard_banners;
create policy "Admins update banners"
  on public.dashboard_banners for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins delete banners" on public.dashboard_banners;
create policy "Admins delete banners"
  on public.dashboard_banners for delete to authenticated
  using (public.is_admin());

-- Public storage bucket for banner images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dashboard-banners',
  'dashboard-banners',
  true,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read dashboard banners" on storage.objects;
create policy "Public read dashboard banners"
  on storage.objects for select
  using (bucket_id = 'dashboard-banners');

drop policy if exists "Admins upload dashboard banners" on storage.objects;
create policy "Admins upload dashboard banners"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dashboard-banners' and public.is_admin());

drop policy if exists "Admins update dashboard banners" on storage.objects;
create policy "Admins update dashboard banners"
  on storage.objects for update to authenticated
  using (bucket_id = 'dashboard-banners' and public.is_admin())
  with check (bucket_id = 'dashboard-banners' and public.is_admin());

drop policy if exists "Admins delete dashboard banners" on storage.objects;
create policy "Admins delete dashboard banners"
  on storage.objects for delete to authenticated
  using (bucket_id = 'dashboard-banners' and public.is_admin());
