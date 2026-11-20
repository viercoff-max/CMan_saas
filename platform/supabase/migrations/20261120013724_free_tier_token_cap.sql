-- Wave 4 / REVIEW-security-2 M3 (database part): lower the monthly AI token budget of new self-serve tenants.
-- Applied to the Supabase project on 2026-11-20 after review; SQL tests passed. Tests: supabase/tests/tenant_rules.sql.
--
-- Before: every new 'free' tenant got 2,000,000 tokens a month on the platform's Anthropic key (x5 tenants per
-- account, unlimited accounts). New default: 300,000 (src/lib/data/rules.ts SUPABASE_FREE_TOKEN_CAP mirrors it).
-- Existing rows: only tenants that are still 'free' AND still on the exact old default (2,000,000) move to 300,000;
-- any cap the platform owner set by hand, and every pro/business tenant, keeps its value. Raise a verified or paying
-- tenant with: update public.tenants set ai_monthly_token_cap = <n> where id = '<uuid>';
-- Browsers gain nothing: tenants still has no browser UPDATE grant (plan, status and caps are platform-only).

alter table public.tenants alter column ai_monthly_token_cap set default 300000;

update public.tenants
   set ai_monthly_token_cap = 300000
 where plan = 'free' and ai_monthly_token_cap = 2000000;
