-- Tests for 20261122120000_team_inbox.sql. Run as postgres (SQL editor / MCP execute_sql) AFTER the migration.
-- The DO block always ends by raising, so every fixture is rolled back. Success: "TEAM_INBOX_TESTS_PASSED (n checks)".
do $$
declare
  ua uuid := gen_random_uuid();   -- member of A
  ub uuid := gen_random_uuid();   -- member of B only
  ta uuid; tb uuid; ca uuid; cb uuid; custa uuid; custb uuid;
  n int; checks int := 0; failed boolean;
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'team-a@example.com', 'authenticated', 'authenticated'), (ub, 'team-b@example.com', 'authenticated', 'authenticated');
  insert into public.tenants (name, slug) values ('Team A', 'team-test-a') returning id into ta;
  insert into public.tenants (name, slug) values ('Team B', 'team-test-b') returning id into tb;
  insert into public.tenant_members (tenant_id, user_id, role) values (ta, ua, 'owner'), (tb, ub, 'owner');
  insert into public.customers (tenant_id, name) values (ta, 'Ana') returning id into custa;
  insert into public.customers (tenant_id, name) values (tb, 'Beto') returning id into custb;
  insert into public.conversations (tenant_id, channel, external_id, customer_id) values (ta, 'telegram', 'team-a-1', custa) returning id into ca;
  insert into public.conversations (tenant_id, channel, external_id, customer_id) values (tb, 'telegram', 'team-b-1', custb) returning id into cb;
  insert into public.conversation_notes (tenant_id, conversation_id, author_user_id, body) values (ta, ca, ua, 'nota A'), (tb, cb, ub, 'nota B');
  insert into public.conversation_events (tenant_id, conversation_id, actor_user_id, kind) values (ta, ca, ua, 'assigned'), (tb, cb, ub, 'assigned');

  -- New statuses accepted; unknown ones refused.
  update public.conversations set status = 'pending' where id = ca;
  update public.conversations set status = 'waiting_customer' where id = ca;
  failed := false;
  begin update public.conversations set status = 'snoozed' where id = ca; exception when check_violation then failed := true; end;
  if not failed then raise exception 'FAIL unknown status accepted'; end if; checks := checks + 1;

  -- Assignee must be a member of the same tenant.
  update public.conversations set assigned_to = ua where id = ca;
  failed := false;
  begin update public.conversations set assigned_to = ub where id = ca; exception when check_violation then failed := true; end;
  if not failed then raise exception 'FAIL cross-tenant assignee accepted'; end if; checks := checks + 1;

  -- A conversation cannot point at another tenant's customer (composite FK).
  failed := false;
  begin update public.conversations set customer_id = custb where id = ca; exception when foreign_key_violation then failed := true; end;
  if not failed then raise exception 'FAIL cross-tenant customer link accepted'; end if; checks := checks + 1;
  -- A note cannot point at another tenant's conversation.
  failed := false;
  begin insert into public.conversation_notes (tenant_id, conversation_id, body) values (ta, cb, 'x'); exception when foreign_key_violation then failed := true; end;
  if not failed then raise exception 'FAIL cross-tenant note accepted'; end if; checks := checks + 1;

  -- RLS: user A sees only tenant A rows in the three new tables, and cannot write them.
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.customers where tenant_id in (ta, tb);
  if n <> 1 then raise exception 'FAIL customers visible to A: %', n; end if;
  select count(*) into n from public.conversation_notes where tenant_id in (ta, tb);
  if n <> 1 then raise exception 'FAIL notes visible to A: %', n; end if;
  select count(*) into n from public.conversation_events where tenant_id in (ta, tb);
  if n <> 1 then raise exception 'FAIL events visible to A: %', n; end if;
  checks := checks + 1;
  failed := false;
  begin insert into public.conversation_notes (tenant_id, conversation_id, body) values (ta, ca, 'browser'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL browser can insert notes'; end if; checks := checks + 1;
  failed := false;
  begin update public.customers set name = 'x' where id = custa; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL browser can update customers'; end if; checks := checks + 1;
  execute 'set local role anon';
  failed := false;
  begin perform 1 from public.customers limit 1; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL anon can read customers'; end if; checks := checks + 1;
  execute 'reset role';

  -- Deleting a conversation removes its notes and events; deleting a customer unlinks (does not delete) conversations.
  delete from public.conversations where id = cb;
  select count(*) into n from public.conversation_notes where conversation_id = cb;
  if n <> 0 then raise exception 'FAIL notes not cascaded'; end if;
  select count(*) into n from public.conversation_events where conversation_id = cb;
  if n <> 0 then raise exception 'FAIL events not cascaded'; end if;
  delete from public.customers where id = custa;
  select count(*) into n from public.conversations where id = ca and customer_id is null;
  if n <> 1 then raise exception 'FAIL customer delete did not unlink'; end if;
  checks := checks + 1;

  raise exception 'TEAM_INBOX_TESTS_PASSED (% checks)', checks;
end;
$$;
