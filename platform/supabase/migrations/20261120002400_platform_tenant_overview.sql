-- Wave 1 (platform admin): one-call tenant list with this month's counts for the platform-admin screen.
-- Applied to the Supabase project on 2026-11-20 (backslash escaping fixed before applying). Test: supabase/tests/platform_tenant_overview.sql.
--
-- Used by src/lib/data/supabase/people.ts tenants.listAll(). It is CROSS-TENANT by design, so:
--   * EXECUTE is granted ONLY to service_role (revoked from public, anon, authenticated: Supabase's default privileges
--     would otherwise expose a new public function through /rest/v1/rpc to browser roles);
--   * the app calls it only after platformAdmins.isPlatformAdmin(userId) (public.platform_admins) is true;
--   * SECURITY DEFINER with search_path = '' and fully qualified names (no search_path hijacking);
--   * read-only (STABLE): it never writes.
-- Returns {"total": <tenants matching p_search>, "items": [ {id, name, slug, plan, status, ai_monthly_token_cap,
-- created_at, members, conversations_this_month, connected_channels, ai_tokens_this_month}, ... ]}, newest first.
-- Counts (per tenant, one indexed subquery each):
--   members                  = tenant_members rows                                   (pk tenant_id, user_id)
--   conversations_this_month = non-simulator conversations with last_message_at >= p_period 00:00 UTC
--                                                                                     (idx_conv_tenant_last)
--   connected_channels       = channel_accounts with status 'connected'             (pk tenant_id, channel)
--   ai_tokens_this_month     = ai_usage.input_tokens + output_tokens of p_period     (pk tenant_id, period)
-- p_search: case-insensitive substring of name or slug; LIKE wildcards in it are escaped (matched literally).

create or replace function public.platform_tenant_overview(p_period date, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_from timestamptz;
  v_pattern text;
  v_total bigint;
  v_items jsonb;
begin
  if p_period is null or p_period <> date_trunc('month', p_period)::date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_from := p_period::timestamp at time zone 'UTC';
  v_pattern := case
    when coalesce(btrim(p_search), '') = '' then null
    else '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  select count(*) into v_total
    from public.tenants t
   where v_pattern is null or t.name ilike v_pattern or t.slug ilike v_pattern;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_items
    from (
      select t.id, t.name, t.slug, t.plan, t.status, t.ai_monthly_token_cap, t.created_at,
             (select count(*) from public.tenant_members m where m.tenant_id = t.id) as members,
             (select count(*) from public.conversations c
               where c.tenant_id = t.id and c.channel <> 'simulator' and c.last_message_at >= v_from) as conversations_this_month,
             (select count(*) from public.channel_accounts ch
               where ch.tenant_id = t.id and ch.status = 'connected') as connected_channels,
             coalesce((select u.input_tokens + u.output_tokens from public.ai_usage u
                        where u.tenant_id = t.id and u.period = p_period), 0) as ai_tokens_this_month
        from public.tenants t
       where v_pattern is null or t.name ilike v_pattern or t.slug ilike v_pattern
       order by t.created_at desc, t.id
       limit v_limit offset v_offset
    ) x;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

revoke all on function public.platform_tenant_overview(date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_tenant_overview(date, text, integer, integer) to service_role;
