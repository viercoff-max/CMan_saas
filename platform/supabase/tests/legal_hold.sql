-- Sticky legal hold tests (migration 20261120013722_legal_hold_sticky, REVIEW-security-2 H1). Run as postgres
-- (SQL editor / MCP execute_sql) AFTER the migration is applied. The DO block always ends by raising, so every fixture
-- is rolled back. Success message: "LEGAL_HOLD_TESTS_PASSED (n checks)". Any other message = a failed check.
do $$
declare
  ta uuid; tb uuid; c_safety uuid; c_legal uuid; c_plain uuid; c_state uuid; cb uuid;
  h boolean; n int; r jsonb; checks int := 0;
begin
  insert into public.tenants (name, slug) values ('Hold A', 'hold-test-a') returning id into ta;
  insert into public.tenants (name, slug) values ('Hold B', 'hold-test-b') returning id into tb;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values (ta, 'messenger', 'h-safety', now() - interval '200 days') returning id into c_safety;
  insert into public.conversations (tenant_id, channel, external_id, escalation_reason) values (ta, 'messenger', 'h-legal', 'legal') returning id into c_legal;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values (ta, 'messenger', 'h-plain', now() - interval '200 days') returning id into c_plain;
  insert into public.conversations (tenant_id, channel, external_id, state) values (ta, 'messenger', 'h-state', '{"legalHold": true}') returning id into c_state;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values (tb, 'messenger', 'h-safety', now() - interval '200 days') returning id into cb;
  insert into public.messages (tenant_id, conversation_id, direction, sender, body, created_at) values
    (ta, c_safety, 'in', 'customer', 'sacó humo y me quemé', now() - interval '200 days'),
    (ta, c_plain, 'in', 'customer', 'hola', now() - interval '200 days'),
    (tb, cb, 'in', 'customer', 'hola B', now() - interval '200 days');

  -- Inserted with a safety/legal reason or state.legalHold: held from the start.
  select legal_hold into h from public.conversations where id = c_legal;
  if not h then raise exception 'FAIL insert with reason legal is not held'; end if; checks := checks + 1;
  select legal_hold into h from public.conversations where id = c_state;
  if not h then raise exception 'FAIL insert with state.legalHold is not held'; end if; checks := checks + 1;

  -- The server escalates (service role, as the app does), then the inbox resolves: reason cleared, hold kept.
  execute 'set local role service_role';
  update public.conversations set status = 'needs_human', escalation_reason = 'safety' where id = c_safety;
  select legal_hold into h from public.conversations where id = c_safety;
  if not h then raise exception 'FAIL safety escalation did not set legal_hold'; end if; checks := checks + 1;

  update public.conversations set status = 'resolved', escalation_reason = null, state = '{}'::jsonb where id = c_safety;
  select legal_hold into h from public.conversations where id = c_safety;
  if not h then raise exception 'FAIL resolve (reason cleared) lifted the hold'; end if; checks := checks + 1;

  update public.conversations set status = 'needs_human', escalation_reason = 'human_request' where id = c_safety;
  update public.conversations set legal_hold = false where id = c_safety; -- app code can never clear it
  select legal_hold into h from public.conversations where id = c_safety;
  if not h then raise exception 'FAIL re-escalation or a direct write cleared the hold'; end if; checks := checks + 1;

  -- Other reasons never hold; tenant B's conversation with the same external id is untouched (cross-tenant).
  update public.conversations set status = 'needs_human', escalation_reason = 'no_answer' where id = c_plain;
  select legal_hold into h from public.conversations where id = c_plain;
  if h then raise exception 'FAIL no_answer escalation set a hold'; end if; checks := checks + 1;
  select legal_hold into h from public.conversations where id = cb;
  if h then raise exception 'FAIL tenant B conversation got a hold'; end if; checks := checks + 1;

  -- The purge keeps the resolved safety case (reason now null) and deletes the ordinary idle one.
  r := public.retention_purge_tenant(ta, now() - interval '90 days', now() - interval '365 days', '[eliminado]');
  select count(*) into n from public.conversations where id = c_safety;
  if n <> 1 then raise exception 'FAIL purge deleted a held conversation after resolve %', r; end if;
  select count(*) into n from public.messages where conversation_id = c_safety;
  if n <> 1 then raise exception 'FAIL purge deleted held messages %', r; end if;
  select count(*) into n from public.conversations where id = c_plain;
  if n <> 0 then raise exception 'FAIL purge kept an ordinary idle conversation %', r; end if;
  select count(*) into n from public.conversations where id = cb;
  if n <> 1 then raise exception 'FAIL purge of tenant A touched tenant B'; end if;
  checks := checks + 1;

  -- Lifting is a deliberate platform action: only with app.lift_legal_hold = 'on' in the same transaction.
  execute 'reset role';
  perform set_config('app.lift_legal_hold', 'on', true);
  update public.conversations set legal_hold = false where id = c_safety;
  perform set_config('app.lift_legal_hold', '', true);
  select legal_hold into h from public.conversations where id = c_safety;
  if h then raise exception 'FAIL an explicit, flagged lift did not clear the hold'; end if; checks := checks + 1;

  -- The guard function is not callable by browser roles.
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'app_private' and routine_name = 'conversations_legal_hold_guard' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'FAIL browser roles can execute the legal hold guard'; end if; checks := checks + 1;

  raise exception 'LEGAL_HOLD_TESTS_PASSED (% checks)', checks;
end;
$$;
