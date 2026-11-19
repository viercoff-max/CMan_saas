-- Server RPC tests (rate_limit_hit, usage_add, conversation_touch, retention_purge_tenant,
-- retention_delete_conversations). Run as postgres (SQL editor / MCP execute_sql). The DO block always ends by
-- raising, so all fixtures are rolled back. Success message: "RPC_TESTS_PASSED (7 checks)".
do $$
declare
  ta uuid; tb uuid; c_old uuid; c_hold uuid; c_new uuid; cb uuid;
  r jsonb; n int; checks int := 0; failed boolean;
  nowms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  insert into public.tenants (name, slug) values ('RPC A', 'rpc-test-a') returning id into ta;
  insert into public.tenants (name, slug) values ('RPC B', 'rpc-test-b') returning id into tb;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values (ta, 'telegram', 'old', now() - interval '200 days') returning id into c_old;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at, escalation_reason) values (ta, 'telegram', 'hold', now() - interval '400 days', 'safety') returning id into c_hold;
  insert into public.conversations (tenant_id, channel, external_id) values (ta, 'telegram', 'new') returning id into c_new;
  insert into public.conversations (tenant_id, channel, external_id, last_message_at) values (tb, 'telegram', 'b-old', now() - interval '200 days') returning id into cb;
  insert into public.messages (tenant_id, conversation_id, direction, sender, body, created_at) values
    (ta, c_old, 'in', 'customer', 'viejo', now() - interval '200 days'),
    (ta, c_hold, 'in', 'customer', 'humo', now() - interval '400 days'),
    (ta, c_new, 'in', 'customer', 'nuevo', now()),
    (tb, cb, 'in', 'customer', 'b viejo', now() - interval '200 days');

  -- Browser roles cannot call the server RPCs.
  execute 'set local role authenticated';
  failed := false;
  begin perform public.usage_add(ta, date_trunc('month', now())::date, 1, 1, 1);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL authenticated can execute usage_add'; end if; checks := checks + 1;
  execute 'set local role anon';
  failed := false;
  begin perform public.retention_delete_conversations(ta, array[c_new]);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL anon can execute retention_delete_conversations'; end if; checks := checks + 1;

  execute 'set local role service_role';
  r := public.rate_limit_hit('rpc-test-key', 2, 60000, nowms);
  if (r->>'ok')::boolean is not true then raise exception 'FAIL rate 1'; end if;
  r := public.rate_limit_hit('rpc-test-key', 2, 60000, nowms + 10);
  if (r->>'ok')::boolean is not true then raise exception 'FAIL rate 2'; end if;
  r := public.rate_limit_hit('rpc-test-key', 2, 60000, nowms + 20);
  if (r->>'ok')::boolean is not false or (r->>'retryAfterS')::int < 1 then raise exception 'FAIL rate 3 %', r; end if;
  r := public.rate_limit_hit('rpc-test-key', 2, 60000, nowms + 60001);
  if (r->>'ok')::boolean is not true then raise exception 'FAIL rate window reset'; end if;
  checks := checks + 1;

  perform public.usage_add(ta, date_trunc('month', now())::date, 1, 100, 20);
  r := public.usage_add(ta, date_trunc('month', now())::date, 2, 50, 5);
  if (r->>'requests')::int <> 3 or (r->>'input_tokens')::int <> 150 or (r->>'output_tokens')::int <> 25 then raise exception 'FAIL usage totals %', r; end if;
  select count(*) into n from public.ai_usage where tenant_id = tb;
  if n <> 0 then raise exception 'FAIL usage leaked to tenant B'; end if;
  checks := checks + 1;

  perform public.conversation_touch(ta, c_new, now(), true);
  select unread into n from public.conversations where id = c_new;
  if n <> 1 then raise exception 'FAIL touch unread=%', n; end if;
  perform public.conversation_touch(ta, cb, now(), true);
  select unread into n from public.conversations where id = cb;
  if n <> 0 then raise exception 'FAIL touch crossed tenants'; end if;
  checks := checks + 1;

  r := public.retention_purge_tenant(ta, now() - interval '90 days', now() - interval '365 days', '[eliminado]');
  if (r->>'conversationsDeleted')::int <> 1 then raise exception 'FAIL purge conversations %', r; end if;
  if (r->>'messagesMasked')::int <> 1 then raise exception 'FAIL purge masking %', r; end if;
  select count(*) into n from public.conversations where id = c_hold;
  if n <> 1 then raise exception 'FAIL legal hold conversation deleted'; end if;
  select count(*) into n from public.conversations where id = c_new;
  if n <> 1 then raise exception 'FAIL recent conversation deleted'; end if;
  select count(*) into n from public.messages where tenant_id = tb;
  if n <> 1 then raise exception 'FAIL purge touched tenant B'; end if;
  checks := checks + 1;

  r := public.retention_delete_conversations(ta, array[c_new, cb]);
  if (r->>'conversations')::int <> 1 then raise exception 'FAIL delete count %', r; end if;
  select count(*) into n from public.conversations where id = cb;
  if n <> 1 then raise exception 'FAIL delete crossed tenants'; end if;
  checks := checks + 1;

  execute 'reset role';
  raise exception 'RPC_TESTS_PASSED (% checks)', checks;
end;
$$;
