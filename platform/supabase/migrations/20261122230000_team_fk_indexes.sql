-- Supabase performance advisor (2026-11-22): cover the user foreign keys of the phase 1 / phase 4 tables, so deleting
-- an auth user (on delete set null / cascade) does not scan these tables.
create index if not exists idx_events_actor on public.conversation_events(actor_user_id);
create index if not exists idx_notes_author on public.conversation_notes(author_user_id);
create index if not exists idx_dashboard_prefs_user on public.dashboard_prefs(user_id);
