-- Wave 4 / REVIEW-security-2 H1: the legal hold becomes STICKY and server-owned.
-- Applied to the Supabase project on 2026-11-20 after review; SQL tests passed. Tests: supabase/tests/legal_hold.sql.
--
-- Before: the hold was derived from the mutable escalation_reason, which "Resolve" / "Return to bot" (resetForBot)
-- clear, so the next purge deleted product-safety transcripts. conversations.legal_hold existed but nothing set it.
-- Now:
--   1) Backfill legal_hold = true for conversations escalated for safety/legal, flagged state.legalHold, or whose
--      messages carry the engine's escalation_safety / escalation_legal intent (already-resolved cases).
--   2) A BEFORE INSERT/UPDATE trigger sets legal_hold = true whenever escalation_reason becomes 'safety'/'legal' (or
--      state.legalHold is set), whatever code path writes the row, and refuses to turn it back to false. Lifting a
--      hold is a deliberate platform/owner action in the SQL editor with an audit row:
--        begin; set local app.lift_legal_hold = 'on'; update public.conversations set legal_hold = false where ...;
--        insert into public.audit_log (...) values (...); commit;
--   3) legal_hold has no browser grant (table_grants never granted it); see 20261120013723 for escalation_reason/state.
-- The retention RPCs already respect legal_hold through app_private.is_legal_hold (unchanged).

update public.conversations c
   set legal_hold = true
 where not c.legal_hold
   and (coalesce(c.escalation_reason, '') in ('safety', 'legal')
        or coalesce(c.state ->> 'legalHold', '') in ('1', 'true')
        or exists (select 1 from public.messages m
                    where m.tenant_id = c.tenant_id and m.conversation_id = c.id
                      and m.meta ->> 'intent' in ('escalation_safety', 'escalation_legal')));

create or replace function app_private.conversations_legal_hold_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.escalation_reason, '') in ('safety', 'legal')
     or coalesce(new.state ->> 'legalHold', '') in ('1', 'true') then
    new.legal_hold := true;
  end if;
  if tg_op = 'UPDATE' and old.legal_hold and not coalesce(new.legal_hold, false)
     and coalesce(current_setting('app.lift_legal_hold', true), '') <> 'on' then
    new.legal_hold := true; -- never cleared by application code
  end if;
  return new;
end;
$$;
revoke all on function app_private.conversations_legal_hold_guard() from public, anon, authenticated;

drop trigger if exists trg_conversations_legal_hold on public.conversations;
create trigger trg_conversations_legal_hold
  before insert or update on public.conversations
  for each row execute function app_private.conversations_legal_hold_guard();
