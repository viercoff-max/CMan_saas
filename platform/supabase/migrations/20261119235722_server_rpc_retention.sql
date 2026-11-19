-- Stage 2 (Supabase DataStore): retention and per-customer deletion, each in ONE transaction.
-- Applied to the Supabase project on 2026-11-19 (owner approved). Tests: supabase/tests/rpc_server_functions.sql.
--
-- Same safety rules as 20261120100000_server_rpc_counters.sql: SECURITY DEFINER, search_path = '', fully
-- qualified names, EXECUTE only for service_role, explicit p_tenant (forced by the app's scoped rpc) and every
-- statement filtered by tenant_id. A PL/pgSQL function body runs inside the caller's single statement, so a
-- failure part-way rolls the whole purge / deletion back (no half-deleted customer).
--
-- Legal hold (kept, never deleted by the purge; bodies masked after the mask window):
--   conversations.legal_hold OR escalation_reason IN ('safety','legal') OR state->>'legalHold' IN ('1','true')
-- which is the SQLite rule (src/lib/data/sqlite/retention.ts) plus the dedicated legal_hold column.

create or replace function app_private.is_legal_hold(p_legal_hold boolean, p_reason text, p_state jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_legal_hold, false)
      or coalesce(p_reason, '') in ('safety', 'legal')
      or coalesce(p_state ->> 'legalHold', '') in ('1', 'true');
$$;
revoke all on function app_private.is_legal_hold(boolean, text, jsonb) from public, anon, authenticated;
grant execute on function app_private.is_legal_hold(boolean, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- retention_purge_tenant: one tenant, atomically
--   1) delete messages older than p_cutoff in conversations NOT on legal hold;
--   2) delete conversations idle since before p_cutoff (not on hold) and their remaining messages;
--   3) mask bodies of legal-hold messages older than p_mask_cutoff (meta.masked = 1).
-- Returns {messagesDeleted, conversationsDeleted, messagesMasked, deletedConversationIds} (counts and ids only).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.retention_purge_tenant(p_tenant uuid, p_cutoff timestamptz, p_mask_cutoff timestamptz, p_masked_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_msgs integer := 0;
  v_convs integer := 0;
  v_masked integer := 0;
  v_ids uuid[];
begin
  if p_tenant is null or p_cutoff is null or p_mask_cutoff is null or p_masked_body is null then
    raise exception 'purge_args_required' using errcode = '22004';
  end if;

  delete from public.messages m
   where m.tenant_id = p_tenant and m.created_at < p_cutoff
     and not exists (
       select 1 from public.conversations c
        where c.tenant_id = p_tenant and c.id = m.conversation_id
          and app_private.is_legal_hold(c.legal_hold, c.escalation_reason, c.state));
  get diagnostics v_n = row_count; v_msgs := v_msgs + v_n;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids
    from public.conversations c
   where c.tenant_id = p_tenant and c.last_message_at < p_cutoff
     and not app_private.is_legal_hold(c.legal_hold, c.escalation_reason, c.state);

  delete from public.messages m where m.tenant_id = p_tenant and m.conversation_id = any (v_ids);
  get diagnostics v_n = row_count; v_msgs := v_msgs + v_n;
  delete from public.conversations c where c.tenant_id = p_tenant and c.id = any (v_ids);
  get diagnostics v_convs = row_count;

  update public.messages m
     set body = p_masked_body, meta = m.meta || jsonb_build_object('masked', 1)
   where m.tenant_id = p_tenant and m.body <> p_masked_body and m.created_at < p_mask_cutoff
     and exists (
       select 1 from public.conversations c
        where c.tenant_id = p_tenant and c.id = m.conversation_id
          and app_private.is_legal_hold(c.legal_hold, c.escalation_reason, c.state));
  get diagnostics v_masked = row_count;

  return jsonb_build_object('messagesDeleted', v_msgs, 'conversationsDeleted', v_convs,
                            'messagesMasked', v_masked, 'deletedConversationIds', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- retention_delete_conversations: delete the given conversations of ONE tenant and their messages atomically
-- (customer deletion / ARCO, Meta data-deletion callback, inbox "delete conversation"). Ids of other tenants are
-- ignored (tenant_id filter). Returns {conversations, messages} counts.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.retention_delete_conversations(p_tenant uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_msgs integer := 0;
  v_convs integer := 0;
begin
  if p_tenant is null then
    raise exception 'tenant_required' using errcode = '22004';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('conversations', 0, 'messages', 0);
  end if;
  delete from public.messages m where m.tenant_id = p_tenant and m.conversation_id = any (p_ids);
  get diagnostics v_msgs = row_count;
  delete from public.engine_inbound_log l where l.tenant_id = p_tenant and l.conversation_id = any (p_ids);
  delete from public.conversations c where c.tenant_id = p_tenant and c.id = any (p_ids);
  get diagnostics v_convs = row_count;
  return jsonb_build_object('conversations', v_convs, 'messages', v_msgs);
end;
$$;

revoke all on function public.retention_purge_tenant(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.retention_delete_conversations(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.retention_purge_tenant(uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function public.retention_delete_conversations(uuid, uuid[]) to service_role;
