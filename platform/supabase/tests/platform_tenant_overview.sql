-- Tests for public.platform_tenant_overview (migration 20261120090000_platform_tenant_overview.sql).
-- Run as postgres (SQL editor / MCP execute_sql) AFTER the migration is applied. The DO block always ends by raising,
-- so every fixture is rolled back. Success message: "PLATFORM_OVERVIEW_TESTS_PASSED (n checks)".
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ta uuid; tb uuid; tc uuid;
  period date := date_trunc('month', now())::date;
  r jsonb; a jsonb; b jsonb;
  checks int := 0; failed boolean;
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'pto-a@example.com', 'authenticated', 'authenticated'),
    (ub, 'pto-b@example.com', 'authenticated', 'authenticated');
  insert into public.tenants (name, slug, created_at) values ('PTO Alpha', 'pto-test-alpha', now() - interval '2 days') returning id into ta;
  insert into public.tenants (name, slug, created_at) values ('PTO Beta 50%', 'pto-test-beta', now() - interval '1 day') returning id into tb;
  insert into public.tenants (name, slug, created_at) values ('PTO Gamma', 'pto-test-gamma', now()) returning id into tc;
  insert into public.tenant_members (tenant_id, user_id, role) values (ta, ua, 'owner'), (ta, ub, 'agent'), (tb, ub, 'owner');
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values
    (ta, 'telegram', 'a-now', now()),
    (ta, 'whatsapp', 'a-now-2', now()),
    (ta, 'simulator', 'a-sim', now()),                                         -- not counted
    (ta, 'telegram', 'a-old', (period::timestamp at time zone 'UTC') - interval '1 day'),  -- last month: not counted
    (tb, 'telegram', 'b-now', now());
  insert into public.channel_accounts (tenant_id, channel, status, external_id) values
    (ta, 'telegram', 'connected', 'pto-bot-a'), (ta, 'whatsapp', 'disconnected', null), (tb, 'telegram', 'connected', 'pto-bot-b');
  insert into public.ai_usage (tenant_id, period, requests, input_tokens, output_tokens) values
    (ta, period, 3, 1000, 250),
    (ta, (period - interval '1 month')::date, 1, 99999, 1),                    -- other month: not counted
    (tb, period, 1, 10, 5);

  -- Browser roles cannot call it.
  execute 'set local role authenticated';
  failed := false;
  begin perform public.platform_tenant_overview(period, null, 50, 0);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL authenticated can execute platform_tenant_overview'; end if; checks := checks + 1;
  execute 'set local role anon';
  failed := false;
  begin perform public.platform_tenant_overview(period, null, 50, 0);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL anon can execute platform_tenant_overview'; end if; checks := checks + 1;

  execute 'set local role service_role';
  r := public.platform_tenant_overview(period, 'pto-test', 50, 0);
  if (r->>'total')::int <> 3 or jsonb_array_length(r->'items') <> 3 then raise exception 'FAIL total/items %', r; end if;
  if r->'items'->0->>'slug' <> 'pto-test-gamma' or r->'items'->2->>'slug' <> 'pto-test-alpha' then raise exception 'FAIL order %', r; end if;
  checks := checks + 1;

  select x into a from jsonb_array_elements(r->'items') x where x->>'id' = ta::text;
  select x into b from jsonb_array_elements(r->'items') x where x->>'id' = tb::text;
  if (a->>'members')::int <> 2 or (a->>'conversations_this_month')::int <> 2 or (a->>'connected_channels')::int <> 1
     or (a->>'ai_tokens_this_month')::bigint <> 1250 then raise exception 'FAIL counts A %', a; end if;
  if (b->>'members')::int <> 1 or (b->>'conversations_this_month')::int <> 1 or (b->>'connected_channels')::int <> 1
     or (b->>'ai_tokens_this_month')::bigint <> 15 then raise exception 'FAIL counts B (or A leaked into B) %', b; end if;
  if a->>'plan' <> 'free' or a->>'status' <> 'active' or (a->>'ai_monthly_token_cap')::bigint <> 2000000 then raise exception 'FAIL tenant fields %', a; end if;
  checks := checks + 1;

  r := public.platform_tenant_overview(period, 'pto-test', 2, 0);
  if (r->>'total')::int <> 3 or jsonb_array_length(r->'items') <> 2 then raise exception 'FAIL limit %', r; end if;
  r := public.platform_tenant_overview(period, 'pto-test', 2, 2);
  if jsonb_array_length(r->'items') <> 1 or r->'items'->0->>'slug' <> 'pto-test-alpha' then raise exception 'FAIL offset %', r; end if;
  checks := checks + 1;

  -- Search is case-insensitive and treats LIKE wildcards literally.
  r := public.platform_tenant_overview(period, 'PTO BETA', 50, 0);
  if (r->>'total')::int <> 1 then raise exception 'FAIL case-insensitive search %', r; end if;
  r := public.platform_tenant_overview(period, '50%', 50, 0);
  if (r->>'total')::int <> 1 or r->'items'->0->>'slug' <> 'pto-test-beta' then raise exception 'FAIL literal percent %', r; end if;
  r := public.platform_tenant_overview(period, 'pto_test', 50, 0);
  if (r->>'total')::int <> 0 then raise exception 'FAIL literal underscore %', r; end if;
  r := public.platform_tenant_overview(period, 'pto\', 50, 0);
  if (r->>'total')::int <> 0 then raise exception 'FAIL literal backslash %', r; end if;
  checks := checks + 1;

  -- Bad period is rejected.
  failed := false;
  begin perform public.platform_tenant_overview((period + 1), null, 50, 0);
  exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'FAIL mid-month period accepted'; end if; checks := checks + 1;

  execute 'reset role';
  raise exception 'PLATFORM_OVERVIEW_TESTS_PASSED (% checks)', checks;
end;
$$;
