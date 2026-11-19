-- SaaS MVP: multi-tenant schema (Supabase / Postgres 17).
-- Design rules:
--   * Every row belongs to a tenant. Composite foreign keys (tenant_id, id) make cross-tenant references impossible.
--   * RLS is enabled on EVERY table. Browser clients (role "authenticated") only see their own tenants' rows.
--   * Secrets (channel/add-on tokens) live in tenant_secrets, which has NO client policies (server only).
--   * Webhooks and background jobs use the service role and must scope by tenant in code.
--   * Login is Supabase Auth (auth.users). Memberships give roles: owner > admin > agent.

-- ---------------------------------------------------------------------------------------------------------------
-- Private helpers (not exposed through the Data API)
-- ---------------------------------------------------------------------------------------------------------------
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Tenants and people
-- ---------------------------------------------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  ai_monthly_token_cap bigint not null default 2000000 check (ai_monthly_token_cap >= 0),
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'agent')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index idx_tenant_members_user on public.tenant_members(user_id);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+$'),
  role text not null check (role in ('admin', 'agent')),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invitations_tenant on public.invitations(tenant_id);

-- Membership checks used by RLS. SECURITY DEFINER avoids RLS recursion on tenant_members; search_path is pinned.
create or replace function app_private.is_member(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = (select auth.uid())
  );
$$;

create or replace function app_private.has_role(t uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function app_private.is_admin(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_role(t, array['owner', 'admin']);
$$;

-- Safe cast for storage paths like "<tenant_id>/file.pdf" (returns null instead of raising).
create or replace function app_private.uuid_or_null(s text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return s::uuid;
exception when others then
  return null;
end;
$$;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Per-tenant settings
-- ---------------------------------------------------------------------------------------------------------------
create table public.brand_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  logo_path text check (logo_path is null or char_length(logo_path) <= 300),
  primary_color text not null default '#0F766E' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#14181F' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  menu_bg_color text not null default '#F6F7F9' check (menu_bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text not null default 'system' check (heading_font ~ '^[A-Za-z0-9 ]{1,60}$'),
  updated_at timestamptz not null default now()
);

create table public.agent_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  agent_name text not null default 'Asistente' check (char_length(agent_name) <= 60),
  tone_level smallint not null default 3 check (tone_level between 1 and 5),
  language_default text not null default 'es' check (language_default in ('es', 'en')),
  language_alt text not null default 'en' check (language_alt in ('es', 'en')),
  greeting text not null default '' check (char_length(greeting) <= 1000),
  fallback_message text not null default '' check (char_length(fallback_message) <= 1000),
  handoff_email text not null default '' check (char_length(handoff_email) <= 320),
  business_hours jsonb not null default '{}'::jsonb,
  cross_sell_level smallint not null default 1 check (cross_sell_level between 0 and 3),
  bot_enabled boolean not null default true,
  tone_saved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- Knowledge: sources, context sections, chunks
-- ---------------------------------------------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('link', 'file')),
  title text not null check (char_length(title) between 1 and 300),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  storage_path text check (storage_path is null or char_length(storage_path) <= 500),
  status text not null default 'pending' check (status in ('pending', 'indexed', 'error')),
  error text check (error is null or char_length(error) <= 200),
  content_text text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null))
);
create index idx_sources_tenant_created on public.sources(tenant_id, created_at desc);

create table public.context_sections (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key in ('business', 'products', 'shipping_returns', 'warranty', 'faq', 'escalation', 'dos_donts', 'extra')),
  content text not null default '' check (char_length(content) <= 50000),
  mode text not null default 'text' check (mode in ('text', 'file')),
  file_source_id uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key),
  foreign key (tenant_id, file_source_id) references public.sources(tenant_id, id) on delete set null (file_source_id)
);

create table public.section_sources (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section_key text not null check (section_key in ('business', 'products', 'shipping_returns', 'warranty', 'faq', 'escalation', 'dos_donts', 'extra')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, section_key, source_id),
  foreign key (tenant_id, source_id) references public.sources(tenant_id, id) on delete cascade
);
create index idx_section_sources_source on public.section_sources(tenant_id, source_id);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid,
  section_key text check (section_key is null or section_key in ('business', 'products', 'shipping_returns', 'warranty', 'faq', 'escalation', 'dos_donts', 'extra')),
  title text not null default '',
  text text not null,
  tsv tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || text)) stored,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, source_id) references public.sources(tenant_id, id) on delete cascade
);
create index idx_chunks_tenant on public.chunks(tenant_id);
create index idx_chunks_tenant_source on public.chunks(tenant_id, source_id);
create index idx_chunks_tenant_section on public.chunks(tenant_id, section_key);
create index idx_chunks_tsv on public.chunks using gin (tsv);

-- ---------------------------------------------------------------------------------------------------------------
-- Channels, add-ons and their secrets
-- ---------------------------------------------------------------------------------------------------------------
create table public.channel_accounts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp', 'instagram', 'messenger')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  external_id text check (external_id is null or char_length(external_id) <= 200),
  display_name text not null default '' check (char_length(display_name) <= 200),
  -- Public routing id used in the webhook URL (/api/webhooks/telegram/<webhook_id>). The secret lives in tenant_secrets.
  webhook_id uuid not null unique default gen_random_uuid(),
  public_info jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  primary key (tenant_id, channel)
);
-- Two tenants can never both have the same connected bot / page / phone number.
create unique index uq_channel_external on public.channel_accounts(channel, external_id)
  where status = 'connected' and external_id is not null;

create table public.addons (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key in ('shopify')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  public_info jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  primary key (tenant_id, key)
);

-- Server-only. AES-GCM ciphertext produced by the app (lib/crypto.ts); webhook secrets stored as SHA-256 hashes.
create table public.tenant_secrets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('channel', 'addon')),
  key text not null check (char_length(key) <= 40),
  config_enc text,
  webhook_secret_hash text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, kind, key)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp', 'instagram', 'messenger', 'simulator')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  customer_name text not null default '' check (char_length(customer_name) <= 200),
  status text not null default 'bot' check (status in ('bot', 'needs_human', 'human', 'resolved')),
  escalation_reason text check (escalation_reason is null or char_length(escalation_reason) <= 40),
  assigned_to uuid references auth.users(id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  unread integer not null default 0 check (unread >= 0),
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, external_id),
  unique (tenant_id, id)
);
create index idx_conv_tenant_last on public.conversations(tenant_id, last_message_at desc);
create index idx_conv_tenant_status on public.conversations(tenant_id, status, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('customer', 'bot', 'agent')),
  agent_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) <= 8000),
  meta jsonb not null default '{}'::jsonb,
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) on delete cascade
);
create index idx_msg_tenant_conv on public.messages(tenant_id, conversation_id, created_at);
create index idx_msg_tenant_created on public.messages(tenant_id, created_at);
-- Inbound dedupe enforced by the database (same provider message delivered twice = one row).
create unique index uq_msg_provider on public.messages(tenant_id, conversation_id, provider_message_id)
  where provider_message_id is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- Usage, audit, rate limiting
-- ---------------------------------------------------------------------------------------------------------------
create table public.ai_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor text not null check (char_length(actor) <= 80),
  action text not null check (char_length(action) <= 80),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index idx_audit_tenant on public.audit_log(tenant_id, created_at desc);

-- Server-only counters (no client policies).
create table public.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start bigint not null,
  count integer not null check (count >= 0)
);
create table public.engine_lookup_failures (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_hash text not null,
  email_hash text not null,
  at timestamptz not null default now()
);
create index idx_elf_tenant_at on public.engine_lookup_failures(tenant_id, at);
create index idx_elf_order on public.engine_lookup_failures(tenant_id, order_hash, at);
create index idx_elf_email on public.engine_lookup_failures(tenant_id, email_hash, at);
create table public.engine_inbound_log (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  at timestamptz not null default now()
);
create index idx_eil_conv on public.engine_inbound_log(tenant_id, conversation_id, at);

-- ---------------------------------------------------------------------------------------------------------------
-- Row Level Security: enabled everywhere; anon gets nothing.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.invitations enable row level security;
alter table public.brand_settings enable row level security;
alter table public.agent_settings enable row level security;
alter table public.sources enable row level security;
alter table public.context_sections enable row level security;
alter table public.section_sources enable row level security;
alter table public.chunks enable row level security;
alter table public.channel_accounts enable row level security;
alter table public.addons enable row level security;
alter table public.tenant_secrets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_usage enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;
alter table public.engine_lookup_failures enable row level security;
alter table public.engine_inbound_log enable row level security;

revoke all on all tables in schema public from anon;
-- Server-only tables: no grants to browser roles at all.
revoke all on public.tenant_secrets, public.rate_limits, public.engine_lookup_failures, public.engine_inbound_log
  from authenticated;

-- tenants: members read; changes go through the server (plan, status and caps are not tenant-editable).
create policy tenants_select on public.tenants for select to authenticated
  using (app_private.is_member(id));

-- tenant_members: members see their team; admins manage non-owner members.
create policy members_select on public.tenant_members for select to authenticated
  using (app_private.is_member(tenant_id));
create policy members_update on public.tenant_members for update to authenticated
  using (app_private.is_admin(tenant_id) and role <> 'owner')
  with check (app_private.is_admin(tenant_id) and role in ('admin', 'agent'));
create policy members_delete on public.tenant_members for delete to authenticated
  using (app_private.is_admin(tenant_id) and role <> 'owner');

-- platform_admins: a user can only see whether they themselves are a platform admin.
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- invitations: tenant admins can see pending invitations; creation/acceptance go through server or RPC.
create policy invitations_select on public.invitations for select to authenticated
  using (app_private.is_admin(tenant_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (app_private.is_admin(tenant_id));

-- Settings: members read, admins write.
create policy brand_select on public.brand_settings for select to authenticated using (app_private.is_member(tenant_id));
create policy brand_write on public.brand_settings for update to authenticated
  using (app_private.is_admin(tenant_id)) with check (app_private.is_admin(tenant_id));
create policy agent_select on public.agent_settings for select to authenticated using (app_private.is_member(tenant_id));
create policy agent_write on public.agent_settings for update to authenticated
  using (app_private.is_admin(tenant_id)) with check (app_private.is_admin(tenant_id));

-- Knowledge: members read, admins write.
create policy sources_select on public.sources for select to authenticated using (app_private.is_member(tenant_id));
create policy sources_insert on public.sources for insert to authenticated with check (app_private.is_admin(tenant_id));
create policy sources_update on public.sources for update to authenticated
  using (app_private.is_admin(tenant_id)) with check (app_private.is_admin(tenant_id));
create policy sources_delete on public.sources for delete to authenticated using (app_private.is_admin(tenant_id));

create policy sections_select on public.context_sections for select to authenticated using (app_private.is_member(tenant_id));
create policy sections_insert on public.context_sections for insert to authenticated with check (app_private.is_admin(tenant_id));
create policy sections_update on public.context_sections for update to authenticated
  using (app_private.is_admin(tenant_id)) with check (app_private.is_admin(tenant_id));

create policy section_sources_select on public.section_sources for select to authenticated using (app_private.is_member(tenant_id));
create policy section_sources_insert on public.section_sources for insert to authenticated with check (app_private.is_admin(tenant_id));
create policy section_sources_delete on public.section_sources for delete to authenticated using (app_private.is_admin(tenant_id));

create policy chunks_select on public.chunks for select to authenticated using (app_private.is_member(tenant_id));
create policy chunks_insert on public.chunks for insert to authenticated with check (app_private.is_admin(tenant_id));
create policy chunks_delete on public.chunks for delete to authenticated using (app_private.is_admin(tenant_id));

-- Channels and add-ons: members read the public status; connecting/disconnecting goes through the server.
create policy channels_select on public.channel_accounts for select to authenticated using (app_private.is_member(tenant_id));
create policy addons_select on public.addons for select to authenticated using (app_private.is_member(tenant_id));

-- Conversations: any member can work the inbox (take, return to bot, resolve). Creation comes from webhooks (server).
create policy conv_select on public.conversations for select to authenticated using (app_private.is_member(tenant_id));
create policy conv_update on public.conversations for update to authenticated
  using (app_private.is_member(tenant_id)) with check (app_private.is_member(tenant_id));

-- Messages: members read; a member may only add their OWN outbound agent replies. No edits or deletes.
create policy msg_select on public.messages for select to authenticated using (app_private.is_member(tenant_id));
create policy msg_insert_agent on public.messages for insert to authenticated
  with check (
    app_private.is_member(tenant_id)
    and sender = 'agent' and direction = 'out'
    and agent_user_id = (select auth.uid())
  );

-- Usage: members read (Plan y uso screen). Audit: admins read. Writes are server-only.
create policy usage_select on public.ai_usage for select to authenticated using (app_private.is_member(tenant_id));
create policy audit_select on public.audit_log for select to authenticated using (app_private.is_admin(tenant_id));

-- ---------------------------------------------------------------------------------------------------------------
-- RPC: create a tenant (the caller becomes owner) and accept an invitation.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_tenant(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select count(*) into v_count from public.tenant_members where user_id = v_uid and role = 'owner';
  if v_count >= 5 then
    raise exception 'tenant_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.tenants (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v_tenant;
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  insert into public.agent_settings (tenant_id) values (v_tenant);
  insert into public.brand_settings (tenant_id, display_name) values (v_tenant, trim(p_name));
  insert into public.audit_log (tenant_id, actor_user_id, actor, action) values (v_tenant, v_uid, 'user', 'tenant.create');
  return v_tenant;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and accepted_at is null and expires_at > now()
   for update;
  if not found or lower(v_inv.email) <> v_email then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_inv.tenant_id, v_uid, v_inv.role)
    on conflict (tenant_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = v_inv.id;
  insert into public.audit_log (tenant_id, actor_user_id, actor, action) values (v_inv.tenant_id, v_uid, 'user', 'invitation.accept');
  return v_inv.tenant_id;
end;
$$;

revoke all on function public.create_tenant(text, text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Storage: private tenant files ("<tenant_id>/...") and public brand logos ("<tenant_id>/logo.png").
-- SVG is not allowed for logos (it can carry scripts).
-- ---------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tenant-files', 'tenant-files', false, 10485760, array[
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('brand-assets', 'brand-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy tenant_files_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files' and app_private.is_member(app_private.uuid_or_null((storage.foldername(name))[1])));
create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-files' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));
create policy tenant_files_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-files' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])))
  with check (bucket_id = 'tenant-files' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));
create policy tenant_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-files' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));

create policy brand_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));
create policy brand_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'brand-assets' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])))
  with check (bucket_id = 'brand-assets' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));
create policy brand_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'brand-assets' and app_private.is_admin(app_private.uuid_or_null((storage.foldername(name))[1])));
