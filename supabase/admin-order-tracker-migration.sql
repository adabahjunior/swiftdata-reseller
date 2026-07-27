-- Admin master live order tracking (any user, by phone or reference)

create or replace function public.admin_track_orders(
  p_admin_id uuid,
  p_query text default null,
  p_live_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_q text;
  v_orders jsonb;
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin = true) then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  perform public.auto_deliver_pending_orders();

  v_q := trim(coalesce(p_query, ''));

  if not p_live_only and v_q = '' then
    return jsonb_build_object('success', false, 'error', 'Enter a phone number or order reference');
  end if;

  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]'::jsonb)
  into v_orders
  from (
    select
      jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'phone', o.phone,
        'network', o.network,
        'size_gb', o.size_gb,
        'amount', o.amount,
        'status', o.status,
        'failure_reason', o.failure_reason,
        'created_at', o.created_at,
        'completed_at', o.completed_at,
        'provider_status', o.provider_status,
        'provider_name', o.provider_name,
        'provider_error', o.provider_error,
        'provider_submitted_at', o.provider_submitted_at,
        'user_id', o.user_id,
        'user_name', p.full_name,
        'user_email', p.email,
        'topup_code', p.topup_code
      ) as row_data,
      o.created_at as sort_at
    from orders o
    left join profiles p on p.id = o.user_id
    where
      case
        when p_live_only then
          o.status in ('pending', 'processing')
        when v_q ~ '^0[2-5][0-9]{8}$' then
          o.phone = v_q
        else
          o.reference ilike '%' || v_q || '%'
      end
    order by o.created_at desc
    limit case when p_live_only then 100 else 50 end
  ) tracked;

  return jsonb_build_object(
    'success', true,
    'query', nullif(v_q, ''),
    'live_only', p_live_only,
    'orders', v_orders
  );
end;
$func$;

grant execute on function public.admin_track_orders to authenticated;
