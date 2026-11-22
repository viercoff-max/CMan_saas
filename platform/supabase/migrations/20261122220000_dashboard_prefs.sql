-- Phase 4 (2026-11-22): configurable dashboard. Each person picks which metric cards to see and in what order,
-- per business. Written server side (service role, after the session check); members read only their own row.
create table public.dashboard_prefs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cards text[] not null default '{}' check (cardinality(cards) <= 40),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table public.dashboard_prefs enable row level security;
create policy dashboard_prefs_select on public.dashboard_prefs for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_member(tenant_id));
revoke all on public.dashboard_prefs from anon, authenticated;
grant select on public.dashboard_prefs to authenticated;
grant all on public.dashboard_prefs to service_role;

-- The dashboard reads a period of messages / activity per tenant.
create index if not exists idx_events_tenant_created on public.conversation_events(tenant_id, created_at);
