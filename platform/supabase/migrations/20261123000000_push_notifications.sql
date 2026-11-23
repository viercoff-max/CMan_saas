-- Phase 2 (2026-11-23): notifications on the phone / computer (Web Push, installable app).
-- push_subscriptions: one row per device that turned notifications on (per person, per business).
-- notification_prefs: which notices each person wants (per business).
-- notifications: the notice text the device fetches when a (payload-less) push arrives; kept 30 days.
-- All written server side (service role); members read only their own rows.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000),
  user_agent text not null default '' check (char_length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index idx_push_subs_tenant_user on public.push_subscriptions(tenant_id, user_id);
create index idx_push_subs_user on public.push_subscriptions(user_id);

create table public.notification_prefs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  waiting boolean not null default true,
  urgent boolean not null default true,
  assigned boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index idx_notification_prefs_user on public.notification_prefs(user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('waiting', 'urgent', 'assigned', 'test')),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 240),
  url text not null default '/inbox' check (url ~ '^/[A-Za-z0-9/?=&_.-]*$' and char_length(url) <= 300),
  created_at timestamptz not null default now()
);
create index idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index idx_notifications_tenant_created on public.notifications(tenant_id, created_at);

alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
create policy push_subs_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy notification_prefs_select on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions, public.notification_prefs, public.notifications from anon, authenticated;
grant select on public.push_subscriptions, public.notification_prefs, public.notifications to authenticated;
grant all on public.push_subscriptions, public.notification_prefs, public.notifications to service_role;
