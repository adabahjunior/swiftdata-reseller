-- MTN MashUp bulk orders from the dashboard (up to 100 per submit).
-- Each item: { "phone": "024...", "package_code": "MASHUP10" } or { "phone": ..., "package_id": uuid }

create or replace function public.dashboard_place_bulk_mashup_orders(
  p_user_id uuid,
  p_orders jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_success integer := 0;
  v_failed integer := 0;
  v_spent numeric := 0;
  v_package_id uuid;
begin
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    return jsonb_build_object('success', false, 'error', 'Provide at least one order');
  end if;

  if jsonb_array_length(p_orders) > 100 then
    return jsonb_build_object('success', false, 'error', 'Maximum 100 orders per bulk submit');
  end if;

  if coalesce((select value from site_settings where key = 'mashup_enabled'), 'false') <> 'true' then
    return jsonb_build_object('success', false, 'error', 'MTN MashUp is not available yet');
  end if;

  if coalesce((select value from site_settings where key = 'mashup_lane_open'), 'true') = 'false' then
    return jsonb_build_object('success', false, 'error', 'MTN MashUp is temporarily unavailable. Please try again later.');
  end if;

  for v_item in select value from jsonb_array_elements(p_orders)
  loop
    v_package_id := null;
    if coalesce(v_item->>'package_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      v_package_id := (v_item->>'package_id')::uuid;
    end if;

    v_result := public.create_mashup_order(
      p_user_id,
      v_package_id,
      case when v_package_id is null then v_item->>'package_code' end,
      v_item->>'phone',
      'dashboard'
    );

    if coalesce((v_result->>'success')::boolean, false) then
      v_success := v_success + 1;
      v_spent := v_spent + coalesce((v_result->'order'->>'amount')::numeric, 0);
    else
      v_failed := v_failed + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      v_result || jsonb_build_object(
        'phone', v_item->>'phone',
        'package_code', v_item->>'package_code'
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'succeeded', v_success,
    'failed', v_failed,
    'spent', v_spent,
    'results', v_results
  );
end;
$func$;

revoke all on function public.dashboard_place_bulk_mashup_orders(uuid, jsonb) from public, anon;
grant execute on function public.dashboard_place_bulk_mashup_orders(uuid, jsonb) to authenticated;
