-- Tenant rules tests (migrations 20261120013724_free_tier_token_cap, 20261120013754_tenant_status_enforced,
-- 20261120013725_create_tenant_reserved_names; REVIEW-security-2 M3, L1, L8). Run as postgres (SQL editor / MCP
-- execute_sql) AFTER the migrations are applied. The DO block always ends by raising, so every fixture is rolled back.
-- Success message: "TENANT_RULES_TESTS_PASSED (n checks)". Any other message = a failed check.
do $$
declare
  ua uuid := gen_random_uuid();   -- owner of the ACTIVE tenant A
  us uuid := gen_random_uuid();   -- owner of the SUSPENDED tenant S
  ui uuid := gen_random_uuid();   -- invitee of tenant S
  ta uuid; ts uuid; ca uuid; cs uuid; t_new uuid;
  cap bigint; n int; checks int := 0; failed boolean; msg text;
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'owner-a@example.com', 'authenticated', 'authenticated'),
    (us, 'owner-s@example.com', 'authenticated', 'authenticated'),
    (ui, 'invitee@example.com', 'authenticated', 'authenticated');
  insert into public.tenants (name, slug) values ('Rules A', 'rules-test-a') returning id into ta;
  insert into public.tenants (name, slug, status) values ('Rules S', 'rules-test-s', 'suspended') returning id into ts;
  insert into public.tenant_members values (ta, ua, 'owner', now()), (ts, us, 'owner', now());
  insert into public.conversations (tenant_id, channel, external_id) values (ta, 'telegram', 'a-1') returning id into ca;
  insert into public.conversations (tenant_id, channel, external_id) values (ts, 'telegram', 's-1') returning id into cs;
  insert into public.invitations (tenant_id, email, role, token_hash)
    values (ts, 'invitee@example.com', 'agent', encode(extensions.digest('rules-test-token', 'sha256'), 'hex'));

  -- ===== M3: new tenants default to 300,000 tokens a month =====
  select ai_monthly_token_cap into cap from public.tenants where id = ta;
  if cap <> 300000 then raise exception 'FAIL default ai_monthly_token_cap is %', cap; end if; checks := checks + 1;

  -- ===== L1: a member of a SUSPENDED tenant sees their membership and tenant status, but no tenant data =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated', 'email', 'owner-s@example.com')::text, true);
  select count(*) into n from public.tenant_members where user_id = us;
  if n <> 1 then raise exception 'FAIL suspended owner cannot see their own membership'; end if; checks := checks + 1;
  select count(*) into n from public.tenants where id = ts and status = 'suspended';
  if n <> 1 then raise exception 'FAIL suspended owner cannot see the tenant status'; end if; checks := checks + 1;
  select count(*) into n from public.conversations where tenant_id = ts;
  if n <> 0 then raise exception 'FAIL suspended tenant data still readable through RLS'; end if; checks := checks + 1;
  select count(*) into n from public.agent_settings where tenant_id = ts;
  if n <> 0 then raise exception 'FAIL suspended tenant settings still readable'; end if; checks := checks + 1;

  -- A suspended owner cannot start over with a new tenant.
  failed := false;
  begin
    perform public.create_tenant('Nuevo Negocio', 'rules-test-new');
  exception when others then failed := true; get stacked diagnostics msg = message_text;
  end;
  if not failed or msg <> 'tenant_suspended' then raise exception 'FAIL suspended owner created a tenant (%)', msg; end if; checks := checks + 1;

  -- Invitations of a suspended tenant cannot be accepted.
  perform set_config('request.jwt.claims', json_build_object('sub', ui, 'role', 'authenticated', 'email', 'invitee@example.com')::text, true);
  failed := false;
  begin
    perform public.accept_invitation('rules-test-token');
  exception when others then failed := true; get stacked diagnostics msg = message_text;
  end;
  if not failed or msg <> 'invitation_invalid' then raise exception 'FAIL invitation to a suspended tenant accepted (%)', msg; end if; checks := checks + 1;

  -- The ACTIVE tenant's owner is unaffected (and still never sees the other tenant).
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated', 'email', 'owner-a@example.com')::text, true);
  select count(*) into n from public.conversations;
  if n <> 1 then raise exception 'FAIL active owner sees % conversations (expected 1)', n; end if; checks := checks + 1;
  select count(*) into n from public.tenants where id = ts;
  if n <> 0 then raise exception 'FAIL active owner sees the suspended tenant'; end if; checks := checks + 1;

  -- ===== L8: reserved slugs and names; ordinary businesses still work =====
  failed := false;
  begin perform public.create_tenant('Mi Tienda', 'admin');
  exception when others then failed := true; get stacked diagnostics msg = message_text; end;
  if not failed or msg <> 'slug_reserved' then raise exception 'FAIL reserved slug accepted (%)', msg; end if; checks := checks + 1;

  failed := false;
  begin perform public.create_tenant('Mi Tienda', 'momentia-mx');
  exception when others then failed := true; get stacked diagnostics msg = message_text; end;
  if not failed or msg <> 'slug_reserved' then raise exception 'FAIL platform-brand slug accepted (%)', msg; end if; checks := checks + 1;

  failed := false;
  begin perform public.create_tenant('S.O.P.O.R.T.E', 'rules-test-soporte');
  exception when others then failed := true; get stacked diagnostics msg = message_text; end;
  if not failed or msg <> 'name_reserved' then raise exception 'FAIL reserved name accepted (%)', msg; end if; checks := checks + 1;

  t_new := public.create_tenant('Café Aurora', 'rules-test-cafe');
  select ai_monthly_token_cap into cap from public.tenants where id = t_new;
  if t_new is null or cap <> 300000 then raise exception 'FAIL ordinary create_tenant failed or wrong cap (%)', cap; end if; checks := checks + 1;

  -- Anonymous sign-in sessions can never create tenants.
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  failed := false;
  begin perform public.create_tenant('Anon Shop', 'rules-test-anon');
  exception when others then failed := true; get stacked diagnostics msg = message_text; end;
  if not failed or msg <> 'not_authenticated' then raise exception 'FAIL anonymous session created a tenant (%)', msg; end if; checks := checks + 1;

  -- ===== Grants unchanged: create_tenant only for authenticated, never anon =====
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  failed := false;
  begin perform public.create_tenant('x', 'rules-test-x');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL anon can execute create_tenant'; end if; checks := checks + 1;

  execute 'reset role';
  raise exception 'TENANT_RULES_TESTS_PASSED (% checks)', checks;
end;
$$;
