-- Stage 2 (Supabase DataStore): server-only counters that PostgREST cannot update atomically.
-- Applied to the Supabase project on 2026-11-19 (owner approved). Tests: supabase/tests/rpc_server_functions.sql.
--
-- Every function here:
--   * is SECURITY DEFINER with search_path = '' and fully qualified names (no search_path hijacking);
--   * is EXECUTABLE ONLY BY service_role (revoked from public, anon, authenticated: Supabase's default privileges
--     would otherwise let browser roles call new public functions through /rest/v1/rpc);
--   * takes the tenant explicitly (p_tenant) and touches only that tenant's rows. The app always passes it through
--     src/lib/data/supabase/client.ts `scoped(...).rpc`, which forces p_tenant to the caller's tenant.
-- (The service role already bypasses RLS, so SECURITY INVOKER would work as well; DEFINER keeps the functions
--  independent of table grants. Either way the EXECUTE grant is the security boundary.)

-- ---------------------------------------------------------------------------------------------------------------
-- login_attempts: failed-login counters (HMAC-hashed keys, never raw emails/IPs). Server only, like rate_limits.
-- Mirrors the SQLite table used by src/lib/security/rate-limit.ts; purge() deletes old rows.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  key text not null check (char_length(key) <= 200),
  at timestamptz not null default now()
);
create index if not exists idx_login_attempts_key_at on public.login_attempts(key, at);
create index if not exists idx_login_attempts_at on public.login_attempts(at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
grant all on public.login_attempts to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- rate_limit_hit: fixed-window counter in ONE statement (insert or bump, resetting the window when it expired).
-- Same semantics as the SQLite RateLimitsRepo.hit: a new window always allows the request (count = 1); otherwise
-- allowed while count <= p_limit; retry_after = seconds until the window ends. Keys are global (not tenant-owned).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_ms bigint, p_now bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start bigint;
  v_count integer;
  v_ok boolean;
begin
  if p_key is null or p_window_ms is null or p_window_ms <= 0 or p_now is null then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, p_now, 1)
  on conflict (key) do update set
    window_start = case when p_now - r.window_start >= p_window_ms then p_now else r.window_start end,
    count        = case when p_now - r.window_start >= p_window_ms then 1 else r.count + 1 end
  returning r.window_start, r.count into v_start, v_count;
  v_ok := (v_count = 1 and v_start = p_now) or v_count <= p_limit;
  return jsonb_build_object(
    'ok', v_ok,
    'retryAfterS', case when v_ok then 0 else ceil((v_start + p_window_ms - p_now) / 1000.0)::integer end
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- usage_add: accumulate AI usage for (tenant, month) atomically and return the new totals.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.usage_add(p_tenant uuid, p_period date, p_requests integer, p_input_tokens bigint, p_output_tokens bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.ai_usage%rowtype;
begin
  if p_tenant is null or p_period is null then
    raise exception 'tenant_and_period_required' using errcode = '22004';
  end if;
  insert into public.ai_usage as u (tenant_id, period, requests, input_tokens, output_tokens, updated_at)
  values (p_tenant, p_period, greatest(coalesce(p_requests, 0), 0), greatest(coalesce(p_input_tokens, 0), 0),
          greatest(coalesce(p_output_tokens, 0), 0), now())
  on conflict (tenant_id, period) do update set
    requests      = u.requests + excluded.requests,
    input_tokens  = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    updated_at    = now()
  returning u.* into v;
  return jsonb_build_object('requests', v.requests, 'input_tokens', v.input_tokens, 'output_tokens', v.output_tokens);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- conversation_touch: after storing a message, bump last_message_at (and last_inbound_at + unread for inbound)
-- in one UPDATE (no read-modify-write race on unread). Only the given tenant's conversation is touched.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.conversation_touch(p_tenant uuid, p_conversation uuid, p_at timestamptz, p_inbound boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_tenant is null then
    raise exception 'tenant_required' using errcode = '22004';
  end if;
  update public.conversations c set
    last_message_at = coalesce(p_at, now()),
    last_inbound_at = case when p_inbound then coalesce(p_at, now()) else c.last_inbound_at end,
    unread          = c.unread + case when p_inbound then 1 else 0 end
  where c.tenant_id = p_tenant and c.id = p_conversation;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, bigint, bigint) from public, anon, authenticated;
revoke all on function public.usage_add(uuid, date, integer, bigint, bigint) from public, anon, authenticated;
revoke all on function public.conversation_touch(uuid, uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, bigint, bigint) to service_role;
grant execute on function public.usage_add(uuid, date, integer, bigint, bigint) to service_role;
grant execute on function public.conversation_touch(uuid, uuid, timestamptz, boolean) to service_role;
