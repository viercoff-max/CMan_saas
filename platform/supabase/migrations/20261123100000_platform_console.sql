-- Platform console (owner of the platform): global / per-tenant counts and lifting a legal hold.
-- Test: supabase/tests/platform_console.sql. Used by src/lib/data/supabase/platform.ts.
--
-- Both functions are CROSS-TENANT by design, so (same contract as platform_tenant_overview):
--   * EXECUTE only for service_role (revoked from public, anon, authenticated);
--   * the app calls them only after platformAdmins.isPlatformAdmin(userId) is true (lib/platform/admin.ts);
--   * SECURITY DEFINER with search_path = '' and fully qualified names.
-- They return COUNTS and ids only: never message bodies, customer names or contact data.

-- platform_stats(p_now, p_days, p_tenant): read-only.
--   tenants    totals by status and plan (one tenant when p_tenant is given)
--   by_day     non-simulator conversations created per UTC day, p_days days ending on p_now's day (zero-filled)
--   waiting    conversations in needs_human; urgent = the safety / legal ones; oldest_urgent_at; urgent_tenants
--   channels   channel_accounts grouped by (channel, status); channel_errors = (tenant, channel) in status error
--   ai         input / output tokens of p_now's month (ai_usage)
--   legal_holds conversations with legal_hold = true and the number of tenants holding them
--   activity   last non-simulator message per tenant
create or replace function public.platform_stats(p_now timestamptz, p_days integer default 30, p_tenant uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_today date;
  v_day0 date;
  v_period date;
begin
  if p_now is null then
    raise exception 'invalid_now' using errcode = '22023';
  end if;
  v_today := (p_now at time zone 'UTC')::date;
  v_day0 := v_today - (v_days - 1);
  v_period := date_trunc('month', v_today)::date;

  return jsonb_build_object(
    'tenants', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where t.status = 'active'),
        'suspended', count(*) filter (where t.status = 'suspended'),
        'deleted', count(*) filter (where t.status = 'deleted'),
        'free', count(*) filter (where t.plan = 'free'),
        'pro', count(*) filter (where t.plan = 'pro'),
        'business', count(*) filter (where t.plan = 'business'))
      from public.tenants t
      where p_tenant is null or t.id = p_tenant),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'count', coalesce(x.n, 0)) order by g.day), '[]'::jsonb)
      from (select v_day0 + i as day from generate_series(0, v_days - 1) as i) g
      left join (
        select (c.created_at at time zone 'UTC')::date as day, count(*) as n
          from public.conversations c
         where (p_tenant is null or c.tenant_id = p_tenant)
           and c.channel <> 'simulator'
           and c.created_at >= (v_day0::timestamp at time zone 'UTC')
         group by 1
      ) x on x.day = g.day),
    'waiting', (
      select jsonb_build_object(
        'total', count(*),
        'urgent', count(*) filter (where c.escalation_reason in ('safety', 'legal')),
        'urgent_tenants', count(distinct c.tenant_id) filter (where c.escalation_reason in ('safety', 'legal')),
        'oldest_urgent_at', min(c.last_message_at) filter (where c.escalation_reason in ('safety', 'legal')))
      from public.conversations c
      where (p_tenant is null or c.tenant_id = p_tenant) and c.status = 'needs_human' and c.channel <> 'simulator'),
    'channels', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'status', x.status, 'count', x.n) order by x.channel, x.status), '[]'::jsonb)
      from (
        select ch.channel, ch.status, count(*) as n
          from public.channel_accounts ch
         where p_tenant is null or ch.tenant_id = p_tenant
         group by ch.channel, ch.status
      ) x),
    'channel_errors', (
      select coalesce(jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'channel', x.channel) order by x.tenant_id, x.channel), '[]'::jsonb)
      from (
        select ch.tenant_id, ch.channel
          from public.channel_accounts ch
         where ch.status = 'error' and (p_tenant is null or ch.tenant_id = p_tenant)
         order by ch.tenant_id, ch.channel
         limit 100
      ) x),
    'ai', (
      select jsonb_build_object('input', coalesce(sum(u.input_tokens), 0), 'output', coalesce(sum(u.output_tokens), 0))
      from public.ai_usage u
      where u.period = v_period and (p_tenant is null or u.tenant_id = p_tenant)),
    'legal_holds', (
      select jsonb_build_object('total', count(*), 'tenants', count(distinct c.tenant_id))
      from public.conversations c
      where c.legal_hold and (p_tenant is null or c.tenant_id = p_tenant)),
    'activity', (
      select coalesce(jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'last_message_at', x.last_at)), '[]'::jsonb)
      from (
        select c.tenant_id, max(c.last_message_at) as last_at
          from public.conversations c
         where (p_tenant is null or c.tenant_id = p_tenant) and c.channel <> 'simulator'
         group by c.tenant_id
      ) x)
  );
end;
$$;

revoke all on function public.platform_stats(timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.platform_stats(timestamptz, integer, uuid) to service_role;

-- platform_lift_legal_hold: the deliberate, audited way to lift ONE conversation's sticky hold
-- (20261120013722_legal_hold_sticky.sql). Clears legal_hold, a safety/legal escalation_reason and state.legalHold
-- (otherwise the guard trigger and app_private.is_legal_hold would keep it on hold) and writes the audit row in the
-- same transaction. p_reason is a fixed code (no free text: audit rows never carry personal data).
create or replace function public.platform_lift_legal_hold(p_tenant uuid, p_conversation uuid, p_actor text, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if p_tenant is null or p_conversation is null then
    raise exception 'tenant_required' using errcode = '22004';
  end if;
  if coalesce(p_reason, '') not in ('resolved', 'no_risk', 'authority_release', 'error') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'actor_required' using errcode = '22004';
  end if;

  perform set_config('app.lift_legal_hold', 'on', true);
  update public.conversations c
     set legal_hold = false,
         escalation_reason = case when c.escalation_reason in ('safety', 'legal') then null else c.escalation_reason end,
         state = c.state - 'legalHold'
   where c.tenant_id = p_tenant and c.id = p_conversation and c.legal_hold;
  get diagnostics v_n = row_count;
  perform set_config('app.lift_legal_hold', '', true);

  if v_n = 1 then
    insert into public.audit_log (tenant_id, actor, action, detail)
      values (p_tenant, left(p_actor, 80), 'platform.legal_hold.lifted', p_conversation::text || ' ' || p_reason);
  end if;
  return v_n = 1;
end;
$$;

revoke all on function public.platform_lift_legal_hold(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_lift_legal_hold(uuid, uuid, text, text) to service_role;
