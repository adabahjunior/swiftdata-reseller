-- Anonymized live delivery pace for dashboard strip (authenticated users)

create or replace function public.get_live_delivery_pace()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_avg_seconds numeric;
  v_sample integer;
  v_pending integer;
  v_last_at timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select
    percentile_cont(0.5) within group (
      order by extract(epoch from (completed_at - created_at))
    ),
    count(*)::integer
  into v_avg_seconds, v_sample
  from (
    select created_at, completed_at
    from public.orders
    where status = 'completed'
      and completed_at is not null
      and completed_at >= now() - interval '6 hours'
      and completed_at >= created_at
      and admin_visible = true
    order by completed_at desc
    limit 80
  ) recent;

  if v_sample is null or v_sample < 2 then
    select
      percentile_cont(0.5) within group (
        order by extract(epoch from (completed_at - created_at))
      ),
      count(*)::integer
    into v_avg_seconds, v_sample
    from (
      select created_at, completed_at
      from public.orders
      where status = 'completed'
        and completed_at is not null
        and completed_at >= created_at
        and admin_visible = true
      order by completed_at desc
      limit 40
    ) fallback;
  end if;

  select count(*)::integer
  into v_pending
  from public.orders
  where status in ('pending', 'processing')
    and admin_visible = true
    and created_at >= now() - interval '24 hours';

  select max(completed_at)
  into v_last_at
  from public.orders
  where status = 'completed'
    and completed_at is not null
    and admin_visible = true
    and completed_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'success', true,
    'avg_seconds', v_avg_seconds,
    'sample_size', coalesce(v_sample, 0),
    'pending_count', coalesce(v_pending, 0),
    'last_delivered_at', v_last_at
  );
end;
$func$;

grant execute on function public.get_live_delivery_pace() to authenticated;
