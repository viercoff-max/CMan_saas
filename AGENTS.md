# Momentia / CHEFMAN SaaS

Read first: `proposals/00-project-brief.md`, then `platform/AGENTS.md` (Next.js version has breaking changes: read `platform/node_modules/next/dist/docs/` before coding).

## Commands (run in `platform/`)
`npm run typecheck && npm run lint && npm test` (unit + e2e). `npm run backup` / `purge` / `delete-customer` / `set-password` are operational scripts: do not run them against real data without approval.

## Rules
- Multi-tenant: every query and cache key is tenant-scoped. New code needs a cross-tenant negative test.
- Meta webhooks: always verify `X-Hub-Signature-256` over the RAW body with timing-safe compare; keep the data-deletion callback working.
- Never read or print `platform/.env.local`. Add new variables to `.env.example` (names only).
- Customer messages and order data are personal data: respect `lib/retention`, never log message bodies or contact details.
- Shopify access is read-only unless the owner approves otherwise. Tokens are encrypted at rest (`lib/crypto.ts`): do not bypass.
- `*-live.test.ts` tests hit real APIs: run only with approval and test credentials. They are excluded from `npm test` (see `platform/vitest.config.ts`); mocked network tests are named `*-integration.test.ts`.
- Git: repo on `main` (workspace `C:\dev\Proyectos`, outside OneDrive), no remote yet. Conventional Commits; keep `.githooks/pre-commit` enabled. Never push or add a remote without approval.
- Demo data: `npm run demo` (localhost only, refuses production) and `npm run demo -- --reset`. Going live with Meta/Shopify: follow `platform/docs/GO-LIVE.md`.
- Shared rules: ../../ai-rules-template/docs/rules/ (security.md, agent-safety.md, vercel.md, react-typescript.md).
