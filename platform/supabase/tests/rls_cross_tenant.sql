-- Cross-tenant RLS negative tests. Run as the postgres role (SQL editor / MCP execute_sql).
-- Everything happens inside one DO block that ALWAYS ends by raising an exception, so every row it creates is
-- rolled back. Success message: "RLS_TESTS_PASSED (n checks)". Any other message = a failed check.
do $$
declare
  ua uuid := gen_random_uuid();   -- owner of tenant A
  ub uuid := gen_random_uuid();   -- owner of tenant B
  uc uuid := gen_random_uuid();   -- agent in tenant A
  ta uuid;
  tb uuid;
  ca uuid;
  cb uuid;
  n int;
  checks int := 0;
  failed boolean;
begin
  -- Fixtures (as postgres, RLS bypassed)
  insert into auth.users (id, email, aud, role) values
    (ua, 'owner-a@example.com', 'authenticated', 'authenticated'),
    (ub, 'owner-b@example.com', 'authenticated', 'authenticated'),
    (uc, 'agent-a@example.com', 'authenticated', 'authenticated');
  insert into public.tenants (name, slug) values ('Tenant A', 'rls-test-a') returning id into ta;
  insert into public.tenants (name, slug) values ('Tenant B', 'rls-test-b') returning id into tb;
  insert into public.tenant_members values (ta, ua, 'owner', now()), (tb, ub, 'owner', now()), (ta, uc, 'agent', now());
  insert into public.agent_settings (tenant_id) values (ta), (tb);
  insert into public.brand_settings (tenant_id) values (ta), (tb);
  insert into public.conversations (tenant_id, channel, external_id) values (ta, 'telegram', 'cust-a') returning id into ca;
  insert into public.conversations (tenant_id, channel, external_id) values (tb, 'telegram', 'cust-b') returning id into cb;
  insert into public.messages (tenant_id, conversation_id, direction, sender, body) values
    (ta, ca, 'in', 'customer', 'hola A'), (tb, cb, 'in', 'customer', 'hola B');
  insert into public.tenant_secrets (tenant_id, kind, key, config_enc) values (tb, 'channel', 'telegram', 'cipher-b');

  -- Composite FK: a message of tenant A can never point at tenant B's conversation, even for postgres.
  begin
    insert into public.messages (tenant_id, conversation_id, direction, sender, body) values (ta, cb, 'in', 'customer', 'x');
    raise exception 'FAIL composite FK allowed a cross-tenant message';
  exception when foreign_key_violation then checks := checks + 1;
  end;

  -- ===== Act as owner of tenant A =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated', 'email', 'owner-a@example.com')::text, true);

  select count(*) into n from public.tenants;
  if n <> 1 then raise exception 'FAIL owner A sees % tenants (expected 1)', n; end if; checks := checks + 1;

  select count(*) into n from public.conversations where tenant_id = tb;
  if n <> 0 then raise exception 'FAIL owner A sees tenant B conversations'; end if; checks := checks + 1;

  select count(*) into n from public.messages where tenant_id = tb;
  if n <> 0 then raise exception 'FAIL owner A sees tenant B messages'; end if; checks := checks + 1;

  select count(*) into n from public.tenant_members where tenant_id = tb;
  if n <> 0 then raise exception 'FAIL owner A sees tenant B members'; end if; checks := checks + 1;

  failed := false;
  begin
    perform 1 from public.tenant_secrets;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL browser role can read tenant_secrets'; end if; checks := checks + 1;

  update public.agent_settings set agent_name = 'hacked' where tenant_id = tb;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL owner A updated tenant B settings'; end if; checks := checks + 1;

  failed := false;
  begin
    insert into public.sources (tenant_id, kind, title, url) values (tb, 'link', 'x', 'https://example.com');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL owner A inserted a source into tenant B'; end if; checks := checks + 1;

  failed := false;
  begin
    insert into public.messages (tenant_id, conversation_id, direction, sender, body, agent_user_id)
      values (tb, cb, 'out', 'agent', 'x', ua);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL owner A wrote a message into tenant B'; end if; checks := checks + 1;

  -- Own tenant: an agent reply is allowed, a fake "bot" message or a reply signed as someone else is not.
  insert into public.messages (tenant_id, conversation_id, direction, sender, body, agent_user_id)
    values (ta, ca, 'out', 'agent', 'respuesta', ua);
  checks := checks + 1;

  failed := false;
  begin
    insert into public.messages (tenant_id, conversation_id, direction, sender, body) values (ta, ca, 'out', 'bot', 'fake');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL browser role inserted a bot message'; end if; checks := checks + 1;

  failed := false;
  begin
    insert into public.messages (tenant_id, conversation_id, direction, sender, body, agent_user_id)
      values (ta, ca, 'out', 'agent', 'spoof', uc);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL owner A signed a reply as another user'; end if; checks := checks + 1;

  -- Admin cannot delete the owner row of their own tenant through the API.
  delete from public.tenant_members where tenant_id = ta and user_id = ua;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL owner row deleted through the API'; end if; checks := checks + 1;

  -- Cannot promote someone to owner (the WITH CHECK clause rejects the new row).
  failed := false;
  begin
    update public.tenant_members set role = 'owner' where tenant_id = ta and user_id = uc;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL member promoted to owner through the API'; end if; checks := checks + 1;

  -- Column-scoped UPDATE grant: tenant_id is not writable, so a conversation can never move to another tenant.
  failed := false;
  begin
    update public.conversations set tenant_id = tb where id = ca;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL a conversation was moved to another tenant'; end if; checks := checks + 1;

  -- ===== Act as AGENT of tenant A =====
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated', 'email', 'agent-a@example.com')::text, true);

  update public.brand_settings set primary_color = '#000000' where tenant_id = ta;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL agent changed the brand'; end if; checks := checks + 1;

  update public.conversations set status = 'human' where id = ca;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL agent could not take a conversation of their tenant'; end if; checks := checks + 1;

  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FAIL agent can read the audit log'; end if; checks := checks + 1;

  -- ===== Anonymous =====
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  failed := false;
  begin
    perform 1 from public.conversations;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL anon can query conversations'; end if; checks := checks + 1;

  execute 'reset role';
  raise exception 'RLS_TESTS_PASSED (% checks)', checks;
end;
$$;
