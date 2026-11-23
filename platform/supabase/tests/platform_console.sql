-- Tests for public.platform_stats and public.platform_lift_legal_hold (migration 20261123100000_platform_console.sql).
-- Run as postgres (SQL editor / MCP execute_sql) AFTER the migration is applied. The DO block always ends by raising,
-- so every fixture is rolled back. Success message: "PLATFORM_CONSOLE_TESTS_PASSED (n checks)".
do $$
declare
  ta uuid; tb uuid;
  ca uuid; ca2 uuid; cb uuid;
  r jsonb;
  n int;
  checks int := 0; failed boolean;
begin
  insert into public.tenants (name, slug) values ('PCT Alpha', 'pct-test-alpha') returning id into ta;
  insert into public.tenants (name, slug, status, plan) values ('PCT Beta', 'pct-test-beta', 'suspended', 'pro') returning id into tb;
  insert into public.conversations (tenant_id, channel, external_id, status, escalation_reason) values
    (ta, 'telegram', 'pct-a1', 'needs_human', 'safety') returning id into ca;                -- urgent + legal hold (trigger)
  insert into public.conversations (tenant_id, channel, external_id, status, escalation_reason) values
    (ta, 'whatsapp', 'pct-a2', 'needs_human', 'no_answer') returning id into ca2;            -- waiting, not urgent
  insert into public.conversations (tenant_id, channel, external_id) values (ta, 'simulator', 'pct-sim'); -- never counted
  insert into public.conversations (tenant_id, channel, external_id, status, escalation_reason) values
    (tb, 'telegram', 'pct-b1', 'needs_human', 'legal') returning id into cb;
  insert into public.channel_accounts (tenant_id, channel, status, external_id) values
    (ta, 'telegram', 'connected', 'pct-bot-a'), (ta, 'messenger', 'error', null);
  insert into public.ai_usage (tenant_id, period, requests, input_tokens, output_tokens) values
    (ta, date_trunc('month', now())::date, 2, 300, 70);

  -- Browser roles cannot call either function.
  foreach r in array array['"authenticated"'::jsonb, '"anon"'::jsonb] loop
    execute format('set local role %I', r #>> '{}');
    failed := false;
    begin perform public.platform_stats(now(), 7, null); exception when insufficient_privilege then failed := true; end;
    if not failed then raise exception 'FAIL % can execute platform_stats', r; end if;
    failed := false;
    begin perform public.platform_lift_legal_hold(ta, ca, 'x', 'resolved'); exception when insufficient_privilege then failed := true; end;
    if not failed then raise exception 'FAIL % can execute platform_lift_legal_hold', r; end if;
    checks := checks + 2;
    execute 'reset role';
  end loop;

  execute 'set local role service_role';

  -- One tenant: counts only that tenant.
  r := public.platform_stats(now(), 7, ta);
  if (r->'tenants'->>'total')::int <> 1 or (r->'tenants'->>'active')::int <> 1 or (r->'tenants'->>'free')::int <> 1 then raise exception 'FAIL tenants %', r->'tenants'; end if;
  if jsonb_array_length(r->'by_day') <> 7 or (r->'by_day'->6->>'count')::int <> 2 or r->'by_day'->6->>'day' <> to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')
    then raise exception 'FAIL by_day %', r->'by_day'; end if;
  if (r->'waiting'->>'total')::int <> 2 or (r->'waiting'->>'urgent')::int <> 1 or (r->'waiting'->>'urgent_tenants')::int <> 1 or r->'waiting'->>'oldest_urgent_at' is null
    then raise exception 'FAIL waiting %', r->'waiting'; end if;
  if (r->'ai'->>'input')::int <> 300 or (r->'ai'->>'output')::int <> 70 then raise exception 'FAIL ai %', r->'ai'; end if;
  if (r->'legal_holds'->>'total')::int <> 1 then raise exception 'FAIL holds (or B leaked into A) %', r->'legal_holds'; end if;
  if r->'channel_errors' <> jsonb_build_array(jsonb_build_object('tenant_id', ta, 'channel', 'messenger')) then raise exception 'FAIL channel_errors %', r->'channel_errors'; end if;
  if jsonb_array_length(r->'channels') <> 2 or jsonb_array_length(r->'activity') <> 1 then raise exception 'FAIL channels/activity %', r; end if;
  checks := checks + 1;

  -- Whole platform: both tenants.
  r := public.platform_stats(now(), 30, null);
  if jsonb_array_length(r->'by_day') <> 30 or (r->'tenants'->>'suspended')::int < 1 or (r->'waiting'->>'urgent_tenants')::int < 2
     or (r->'legal_holds'->>'tenants')::int < 2 then raise exception 'FAIL global %', r; end if;
  checks := checks + 1;

  failed := false;
  begin perform public.platform_stats(null, 7, null); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'FAIL null now accepted'; end if; checks := checks + 1;

  -- Lift: needs a valid reason; cannot cross tenants; clears the hold and writes the audit row atomically.
  failed := false;
  begin perform public.platform_lift_legal_hold(ta, ca, 'admin-1', 'because'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'FAIL free-text reason accepted'; end if; checks := checks + 1;
  if public.platform_lift_legal_hold(tb, ca, 'admin-1', 'resolved') then raise exception 'FAIL lifted A''s case through B'; end if;
  if public.platform_lift_legal_hold(ta, ca2, 'admin-1', 'resolved') then raise exception 'FAIL lifted a case that was not on hold'; end if;
  checks := checks + 1;
  if not public.platform_lift_legal_hold(ta, ca, 'admin-1', 'resolved') then raise exception 'FAIL lift returned false'; end if;
  select count(*) into n from public.conversations c where c.id = ca and not c.legal_hold and c.escalation_reason is null and not (c.state ? 'legalHold');
  if n <> 1 then raise exception 'FAIL hold not cleared'; end if;
  select count(*) into n from public.audit_log a where a.tenant_id = ta and a.action = 'platform.legal_hold.lifted' and a.detail = ca::text || ' resolved' and a.actor = 'admin-1';
  if n <> 1 then raise exception 'FAIL audit row missing'; end if;
  select count(*) into n from public.conversations c where c.id = cb and c.legal_hold;
  if n <> 1 then raise exception 'FAIL B''s hold changed'; end if;
  if public.platform_lift_legal_hold(ta, ca, 'admin-1', 'resolved') then raise exception 'FAIL lifted twice'; end if;
  checks := checks + 1;

  -- App code still cannot clear a hold directly (the sticky guard is untouched).
  update public.conversations set legal_hold = false where id = cb;
  select count(*) into n from public.conversations c where c.id = cb and c.legal_hold;
  if n <> 1 then raise exception 'FAIL plain update cleared a hold'; end if;
  checks := checks + 1;

  execute 'reset role';
  raise exception 'PLATFORM_CONSOLE_TESTS_PASSED (% checks)', checks;
end;
$$;
