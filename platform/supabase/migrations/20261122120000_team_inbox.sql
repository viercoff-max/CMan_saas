-- Phase 1 "atención en equipo" (2026-11-22): assignment, two more statuses, internal notes, activity log and a
-- customer record (one person across channels) with the full conversation history.
-- Writes are SERVER ONLY (service role through the data layer, after the session's role check); browsers get SELECT
-- under the same tenant RLS as conversations. Tests: supabase/tests/team_inbox.sql (rolled back).

-- 1) Statuses: + 'pending' (team follows up later) and 'waiting_customer' (team asked the customer something).
--    Both are human-owned: the bot stays silent, like 'needs_human' and 'human'.
alter table public.conversations drop constraint conversations_status_check;
alter table public.conversations add constraint conversations_status_check
  check (status in ('bot', 'needs_human', 'human', 'pending', 'waiting_customer', 'resolved'));

-- 2) Assignment: conversations.assigned_to already exists (browser UPDATE grant on it). The assignee must be a member
--    of THE SAME tenant, whatever code path writes it.
create or replace function app_private.conversations_assignee_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from public.tenant_members m where m.tenant_id = new.tenant_id and m.user_id = new.assigned_to) then
      raise exception 'assignee_not_member' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.conversations_assignee_guard() from public, anon, authenticated;
drop trigger if exists trg_conversations_assignee on public.conversations;
create trigger trg_conversations_assignee
  before insert or update of assigned_to on public.conversations
  for each row execute function app_private.conversations_assignee_guard();
create index if not exists idx_conv_tenant_assignee on public.conversations(tenant_id, assigned_to, last_message_at desc);

-- 3) Customers: one record per person; a person who writes on Telegram and WhatsApp can be merged into one.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 200),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 40),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index idx_customers_tenant_updated on public.customers(tenant_id, updated_at desc);

alter table public.conversations add column customer_id uuid;
alter table public.conversations add constraint conversations_customer_fk
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete set null (customer_id);
create index idx_conv_tenant_customer on public.conversations(tenant_id, customer_id);

-- Backfill: one customer per existing real conversation (simulator conversations never get one).
do $$
declare r record; cid uuid;
begin
  for r in select id, tenant_id, customer_name from public.conversations where customer_id is null and channel <> 'simulator' loop
    insert into public.customers (tenant_id, name) values (r.tenant_id, left(r.customer_name, 200)) returning id into cid;
    update public.conversations set customer_id = cid where id = r.id;
  end loop;
end;
$$;

-- 4) Internal notes (never sent to the customer).
create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) on delete cascade
);
create index idx_notes_tenant_conv on public.conversation_notes(tenant_id, conversation_id, created_at);

-- 5) Activity log per conversation (who took it, reassigned it, changed its status, when the bot handed it off).
create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('assigned', 'unassigned', 'status', 'note', 'handoff', 'customer_linked')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references public.conversations(tenant_id, id) on delete cascade
);
create index idx_events_tenant_conv on public.conversation_events(tenant_id, conversation_id, created_at);

-- 6) RLS + grants: members read their tenant's rows; no browser writes.
alter table public.customers enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.conversation_events enable row level security;
create policy customers_select on public.customers for select to authenticated using (app_private.is_member(tenant_id));
create policy notes_select on public.conversation_notes for select to authenticated using (app_private.is_member(tenant_id));
create policy events_select on public.conversation_events for select to authenticated using (app_private.is_member(tenant_id));
revoke all on public.customers, public.conversation_notes, public.conversation_events from anon, authenticated;
grant select on public.customers, public.conversation_notes, public.conversation_events to authenticated;
grant all on public.customers, public.conversation_notes, public.conversation_events to service_role;
