-- Explicit, least-privilege table grants. New Supabase projects do not grant table privileges to the API roles by
-- default, so RLS policies alone are not enough: the role also needs the matching GRANT. UPDATE grants are column
-- scoped so a browser client can only change the fields its screen edits (never tenant_id or ids).

-- Server role (webhooks, background jobs). Bypasses RLS; still needs table privileges.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

grant usage on schema public to authenticated;

grant select on public.tenants to authenticated;

grant select, delete on public.tenant_members to authenticated;
grant update (role) on public.tenant_members to authenticated;

grant select on public.platform_admins to authenticated;

grant select, delete on public.invitations to authenticated;

grant select on public.brand_settings to authenticated;
grant update (display_name, logo_path, primary_color, accent_color, menu_bg_color, heading_font, updated_at)
  on public.brand_settings to authenticated;

grant select on public.agent_settings to authenticated;
grant update (agent_name, tone_level, language_default, language_alt, greeting, fallback_message, handoff_email,
              business_hours, cross_sell_level, bot_enabled, tone_saved_at, updated_at)
  on public.agent_settings to authenticated;

grant select, insert, delete on public.sources to authenticated;
grant update (title, url, storage_path, status, error, content_text, last_synced_at) on public.sources to authenticated;

grant select, insert on public.context_sections to authenticated;
grant update (content, mode, file_source_id, updated_at) on public.context_sections to authenticated;

grant select, insert, delete on public.section_sources to authenticated;

grant select, insert, delete on public.chunks to authenticated;

grant select on public.channel_accounts to authenticated;
grant select on public.addons to authenticated;

grant select on public.conversations to authenticated;
grant update (status, escalation_reason, assigned_to, unread, state) on public.conversations to authenticated;

grant select, insert on public.messages to authenticated;

grant select on public.ai_usage to authenticated;
grant select on public.audit_log to authenticated;

-- Never: tenant_secrets, rate_limits, engine_lookup_failures, engine_inbound_log (server only). anon: nothing.
