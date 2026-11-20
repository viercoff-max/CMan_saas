-- Wave 4 / REVIEW-security-2 M1: browser-role (authenticated) privileges reduced to what the app really uses.
-- Applied to the Supabase project on 2026-11-20 after review; SQL tests passed. Tests: supabase/tests/rls_cross_tenant.sql.
--
-- Threat model: the publishable key is public and a member can read their own access token, so whatever
-- "authenticated" may do through /rest/v1 or /storage/v1, a member can do directly, outside the app's checks.
-- The app itself (grep, wave 4) uses the USER-session client only for tenant_members, invitations, tenants (via the
-- membership embed) and the create_tenant / accept_invitation RPCs. Every other read and write goes through the
-- server's service-role DataStore (src/lib/data/supabase) and Storage FileStore (src/lib/storage/supabase.ts),
-- which bypass these grants and policies. So nothing below changes app behaviour.
--
-- conversations: keep UPDATE (status, assigned_to, unread) only. escalation_reason and state are engine/server
--   state (an agent could otherwise erase the hold signal or the engine's throttle state). legal_hold was never granted.
-- messages: no INSERT (agent replies are written server-side after the channel send succeeded; a browser insert
--   could fabricate transcript rows or pre-claim a provider_message_id). The msg_insert_agent policy is dropped.
-- knowledge + settings: no INSERT/UPDATE/DELETE (the server validates, indexes and audits every change).
-- storage.objects: no browser INSERT/UPDATE/DELETE for 'tenant-files' and 'brand-assets' (uploads go through the
--   server, which checks magic bytes, size and rate limits). tenant_files_select (members read their tenant's
--   files) stays; brand-assets is a public bucket (served by public URL, no SELECT policy needed).

-- Table-level REVOKEs on purpose: they also remove every column-level grant, so the result does not depend on
-- whether a project's default privileges ever granted more than table_grants.sql did.

-- conversations: only the inbox fields stay writable.
revoke update on public.conversations from authenticated;
grant update (status, assigned_to, unread) on public.conversations to authenticated;

-- messages
drop policy if exists msg_insert_agent on public.messages;
revoke insert, update, delete on public.messages from authenticated;

-- knowledge
drop policy if exists sources_insert on public.sources;
drop policy if exists sources_update on public.sources;
drop policy if exists sources_delete on public.sources;
revoke insert, update, delete on public.sources from authenticated;

drop policy if exists sections_insert on public.context_sections;
drop policy if exists sections_update on public.context_sections;
revoke insert, update, delete on public.context_sections from authenticated;

drop policy if exists section_sources_insert on public.section_sources;
drop policy if exists section_sources_delete on public.section_sources;
revoke insert, update, delete on public.section_sources from authenticated;

drop policy if exists chunks_insert on public.chunks;
drop policy if exists chunks_delete on public.chunks;
revoke insert, update, delete on public.chunks from authenticated;

-- settings (Tone and Brand screens save through server actions / the /brand/save route)
drop policy if exists agent_write on public.agent_settings;
revoke insert, update, delete on public.agent_settings from authenticated;
drop policy if exists brand_write on public.brand_settings;
revoke insert, update, delete on public.brand_settings from authenticated;

-- Storage
drop policy if exists tenant_files_insert on storage.objects;
drop policy if exists tenant_files_update on storage.objects;
drop policy if exists tenant_files_delete on storage.objects;
drop policy if exists brand_assets_insert on storage.objects;
drop policy if exists brand_assets_update on storage.objects;
drop policy if exists brand_assets_delete on storage.objects;
