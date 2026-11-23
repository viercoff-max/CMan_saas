-- Tests for 20261123000000_push_notifications.sql. Run as postgres; always rolled back.
-- Success: "PUSH_TESTS_PASSED (n checks)".
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  ta uuid; n int; checks int := 0; failed boolean;
begin
  insert into auth.users (id, email, aud, role) values (ua, 'push-a@example.com', 'authenticated', 'authenticated'), (ub, 'push-b@example.com', 'authenticated', 'authenticated');
  insert into public.tenants (name, slug) values ('Push A', 'push-test-a') returning id into ta;
  insert into public.tenant_members (tenant_id, user_id, role) values (ta, ua, 'owner'), (ta, ub, 'agent');
  insert into public.push_subscriptions (tenant_id, user_id, endpoint) values
    (ta, ua, 'https://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa'), (ta, ub, 'https://fcm.googleapis.com/fcm/send/bbbbbbbbbbbb');
  insert into public.notifications (tenant_id, user_id, kind, title, url) values (ta, ua, 'waiting', 'a', '/inbox'), (ta, ub, 'urgent', 'b', '/inbox');
  -- URL must be a local path (no javascript:, no external links)
  failed := false;
  begin insert into public.notifications (tenant_id, user_id, kind, title, url) values (ta, ua, 'waiting', 'x', 'javascript:alert(1)'); exception when check_violation then failed := true; end;
  if not failed then raise exception 'FAIL non-local notice url accepted'; end if; checks := checks + 1;
  -- Same team, but each person reads only their OWN devices and notices
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select count(*) into n from public.push_subscriptions; if n <> 1 then raise exception 'FAIL A sees % subscriptions', n; end if;
  select count(*) into n from public.notifications; if n <> 1 then raise exception 'FAIL A sees % notices', n; end if;
  checks := checks + 1;
  failed := false;
  begin insert into public.push_subscriptions (tenant_id, user_id, endpoint) values (ta, ua, 'https://fcm.googleapis.com/fcm/send/cccccccccccc'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL browser can register a device directly'; end if; checks := checks + 1;
  failed := false;
  begin update public.notification_prefs set waiting = false; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL browser can write prefs'; end if; checks := checks + 1;
  execute 'set local role anon';
  failed := false;
  begin perform 1 from public.notifications limit 1; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAIL anon reads notices'; end if; checks := checks + 1;
  execute 'reset role';
  -- Deleting the business removes its devices and notices
  delete from public.tenants where id = ta;
  select count(*) into n from public.push_subscriptions where tenant_id = ta; if n <> 0 then raise exception 'FAIL subscriptions not cascaded'; end if;
  select count(*) into n from public.notifications where tenant_id = ta; if n <> 0 then raise exception 'FAIL notices not cascaded'; end if;
  checks := checks + 1;
  raise exception 'PUSH_TESTS_PASSED (% checks)', checks;
end;
$$;
