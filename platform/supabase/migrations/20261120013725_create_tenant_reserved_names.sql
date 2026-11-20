-- Wave 4 / REVIEW-security-2 L8 (+ L1 / M3 guards): create_tenant refuses reserved slugs and names, anonymous
-- sign-in sessions, and owners of a suspended tenant.
-- Applied to the Supabase project on 2026-11-20 after review; SQL tests passed. Tests: supabase/tests/tenant_rules.sql.
--
--   * Reserved words: platform routes and roles, the platform brand and the integrations it names (add known customer
--     brands in a later migration, in BOTH lists, once they sign). The SAME list lives in src/lib/auth/slug.ts
--     (RESERVED_TENANT_WORDS); a unit test fails when the two drift apart. A slug matches when it is exactly a
--     reserved word; a name matches when its lowercase letters/digits (spaces, punctuation removed) are exactly one.
--     Anything containing "momentia" is reserved too (platform brand).
--     Errors: 'slug_reserved' / 'name_reserved' (P0001). The app shows them like "slug taken" (no list disclosure).
--   * auth.jwt() ->> 'is_anonymous' = 'true' -> 'not_authenticated' (anonymous sign-ins must never own tenants).
--   * A user who owns a SUSPENDED tenant cannot create new ones ('tenant_suspended'), so a suspended abuser cannot
--     simply start over under a new slug (M3 cost abuse).
-- Same signature, SECURITY DEFINER, search_path = '' and grants (authenticated only) as the init migration.

create or replace function app_private.is_reserved_tenant_word(p text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p, '') like '%momentia%' or coalesce(p, '') = any (array[
    'admin', 'administrator', 'administrador', 'root', 'system', 'sistema', 'staff', 'owner', 'superuser',
    'api', 'app', 'apps', 'www', 'web', 'mail', 'email', 'smtp', 'cdn', 'static', 'assets', 'files', 'media',
    'auth', 'oauth', 'sso', 'login', 'logout', 'signin', 'signup', 'register', 'registro', 'onboarding', 'invite',
    'account', 'accounts', 'cuenta', 'settings', 'config', 'dashboard', 'inbox', 'billing', 'pagos', 'payments',
    'support', 'soporte', 'help', 'ayuda', 'contact', 'contacto', 'security', 'seguridad', 'abuse', 'status',
    'legal', 'privacy', 'privacidad', 'terms', 'terminos', 'docs', 'blog', 'news', 'about',
    'platform', 'plataforma', 'conversa', 'official', 'oficial', 'verified', 'verificado',
    'webhook', 'webhooks', 'telegram', 'whatsapp', 'instagram', 'messenger', 'meta', 'facebook', 'shopify',
    'anthropic', 'claude', 'supabase', 'vercel',
    'null', 'undefined', 'test', 'demo'
  ]);
$$;
revoke all on function app_private.is_reserved_tenant_word(text) from public, anon;
grant execute on function app_private.is_reserved_tenant_word(text) to authenticated, service_role;

create or replace function public.create_tenant(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_count int;
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name_key text := regexp_replace(lower(trim(coalesce(p_name, ''))), '[^a-z0-9]+', '', 'g');
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if app_private.is_reserved_tenant_word(v_slug) then
    raise exception 'slug_reserved' using errcode = 'P0001';
  end if;
  if app_private.is_reserved_tenant_word(v_name_key) then
    raise exception 'name_reserved' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenant_members m join public.tenants t on t.id = m.tenant_id
              where m.user_id = v_uid and m.role = 'owner' and t.status = 'suspended') then
    raise exception 'tenant_suspended' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.tenant_members where user_id = v_uid and role = 'owner';
  if v_count >= 5 then
    raise exception 'tenant_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.tenants (name, slug) values (trim(p_name), v_slug) returning id into v_tenant;
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_uid, 'owner');
  insert into public.agent_settings (tenant_id) values (v_tenant);
  insert into public.brand_settings (tenant_id, display_name) values (v_tenant, trim(p_name));
  insert into public.audit_log (tenant_id, actor_user_id, actor, action) values (v_tenant, v_uid, 'user', 'tenant.create');
  return v_tenant;
end;
$$;
revoke all on function public.create_tenant(text, text) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;
