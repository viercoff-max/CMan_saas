-- Advisor follow-up (performance): cover foreign keys with indexes and give the log tables a primary key.
create index if not exists idx_audit_actor on public.audit_log(actor_user_id);
create index if not exists idx_sections_file_source on public.context_sections(tenant_id, file_source_id);
create index if not exists idx_conv_assigned on public.conversations(assigned_to);
create index if not exists idx_invitations_invited_by on public.invitations(invited_by);
create index if not exists idx_msg_agent on public.messages(agent_user_id);

alter table public.engine_lookup_failures add column if not exists id bigint generated always as identity primary key;
alter table public.engine_inbound_log add column if not exists id bigint generated always as identity primary key;
