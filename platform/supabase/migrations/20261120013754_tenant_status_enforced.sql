-- Wave 4 / REVIEW-security-2 L1: tenants.status ('suspended' / 'deleted') is enforced by RLS too.
-- Applied to the Supabase project on 2026-11-20 after review; SQL tests passed. Tests: supabase/tests/tenant_rules.sql.
--
-- App side (same wave): session resolution blocks non-active tenants, webhook routing (channels.findByWebhookId /
-- findTenantByExternalId) ignores them and usage.remaining returns 0 (the engine goes offline, no AI spend).
-- Database side (this file), for direct Data API access with a member's own token:
--   * app_private.is_member / has_role (used by every tenant-data policy, is_admin and the tenant-files Storage
--     read policy) now require tenants.status = 'active'. Members of a suspended or deleted tenant read nothing.
--   * app_private.is_member_any keeps the old "any status" meaning, only for tenants_select, and a new
--     members_select_self policy lets a user always see their OWN membership rows. Together they let the app tell
--     "your business is suspended" apart from "you have no business" (tenant name/status only, no customer data).
--   * accept_invitation refuses invitations of a non-active tenant.
-- Same signatures, SECURITY DEFINER, search_path = '' and grants as before.

create or replace function app_private.is_member(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
      join public.tenants tn on tn.id = m.tenant_id
    where m.tenant_id = t and m.user_id = (select auth.uid()) and tn.status = 'active'
  );
$$;

create or replace function app_private.has_role(t uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
      join public.tenants tn on tn.id = m.tenant_id
    where m.tenant_id = t and m.user_id = (select auth.uid()) and m.role = any (roles) and tn.status = 'active'
  );
$$;

create or replace function app_private.is_member_any(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = (select auth.uid())
  );
$$;
revoke all on function app_private.is_member_any(uuid) from public, anon;
grant execute on function app_private.is_member_any(uuid) to authenticated, service_role;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
  using (app_private.is_member_any(id));

drop policy if exists members_select_self on public.tenant_members;
create policy members_select_self on public.tenant_members for select to authenticated
  using (user_id = (select auth.uid()));

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
  if not found or lower(v_inv.email) <> v_email
     or not exists (select 1 from public.tenants t where t.id = v_inv.tenant_id and t.status = 'active') then
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
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
