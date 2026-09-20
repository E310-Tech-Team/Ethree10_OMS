# 02 — Technical Requirements Document

**Product:** Ethree10 OMS (E310)
**Last updated:** 20 September 2026

---

## 1. Tech stack

### Application

| Layer | Choice | Version | Note |
|---|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.3.4 | Three route groups, React Server Components |
| UI | React | 19.2.7 | |
| Language | TypeScript | 5.x | `strict`; `@` alias → project root |
| API | tRPC | 11 | 33 routers, 187 procedures |
| Data | Prisma + PostgreSQL | 6.19.3 | 1,428-line schema |
| Auth | Auth.js (`next-auth`) | 4.24.15 | Custom adapter, JWT sessions |
| Styling | Tailwind CSS + shadcn/ui | 3.4 | Radix primitives |
| Forms | react-hook-form + Zod | | Zod also validates every tRPC input |
| Jobs | BullMQ + Redis | | Separate worker process |
| Charts | Recharts | | |
| PDF | `@react-pdf/renderer` | | Reports, invoices, receipts |

### Services

| Concern | Service | Degrades how |
|---|---|---|
| Transactional email | Resend | Required in production |
| Object storage | S3-compatible (MinIO in prod) | Required |
| Payments | Paystack | `getPaystackSecretKey()` **throws in production** if unset |
| WhatsApp / SMS | Twilio | Production returns `false`; dev logs to console |
| Errors | Sentry | **Not configured** — DSN unset |
| Analytics | PostHog | Optional |
| Task sync | Plane | The only adapter that exists |

---

## 2. Architecture

### Route groups

| Group | Purpose | Auth |
|---|---|---|
| `(marketing)` | Public site, request form, tracking, public invoice/receipt | None |
| `(auth)` | Login, magic-link-sent, unauthorized | None |
| `(app)` | The OMS itself | Session required, enforced in the layout |

### Data access

Staff queries are **agency-global**. There is no `workspaceId` and no scoping header. Use the
`db` singleton from `server/db/client.ts`.

Where a role should see only part of the agency, scope it **explicitly** using
`server/auth/visibility.ts`:

- `visibleTeamIds(userId)` — branches in scope, or `null` for agency-wide roles
- `assertCanAccessTask(userId, taskId, action)` — holds the action **and** the task is in scope
- `assertCanAccessRequest(userId, requestId, action)` — same for requests

> Two separate questions: does the role hold the action, and is this record in the caller's
> branches? Asking only the first *looks* like authorization without being it. Holding
> `task.read` is not permission to read every task.

Out-of-scope records return **NOT_FOUND, not FORBIDDEN** — FORBIDDEN confirms a record exists
and turns a list nobody may read into one anybody may enumerate by id.

A record with **no branch** is visible to anyone holding the action: work sits unrouted
during intake, and a record belonging to no branch cannot belong to another one.

### RBAC

- `Action` union in `server/auth/permissions.ts`; `ROLE_PERMISSIONS` maps role → actions
- `requireAgencyAction(userId, action)` throws `FORBIDDEN`
- `ctx.authorize(action)` is the same check from a tRPC context
- Named groups in `server/auth/role-groups.ts` — **use these, never inline role arrays**
- `super_admin` is granted by the `User.isSuperAdmin` boolean, which short-circuits `can()`;
  its `ROLE_PERMISSIONS` entry is deliberately empty

### Auth

Custom adapter mapping onto `User` + `OAuthAccount` rather than Auth.js table names.
Providers: Resend magic link, Google OAuth, and a dev-only Credentials provider.

The Credentials provider signs anyone in from an email alone. In a production build it is
available **only** when `E2E_TEST_AUTH=true` *and* the app serves on loopback
(`server/auth/dev-login.ts`). Readiness fails a production deploy carrying that variable.

Google requests exactly `openid`, `email`, `profile` — no custom `authorization` is set.

---

## 3. Security requirements

| Requirement | Implementation |
|---|---|
| Deny by default on every procedure | `requireAgencyAction` / `ctx.authorize` + record-level scope |
| Money separation of duties | `assertSeparationOfDuties`, `BudgetService.assertApproved` |
| Unguessable public codes | `server/security/secure-code.ts` — `crypto.randomInt`, Crockford base32, 60 bits |
| Payment idempotency | Conditional `updateMany` claim on `paymentConfirmedAt` |
| Receipt idempotency | `Receipt.invoiceId @unique` + P2002 handling |
| Real client IP | `server/security/client-ip.ts` — **last** `x-forwarded-for` hop |
| Public rate limiting | DB-backed fixed window, shared across instances |
| Upload safety | MIME allowlist, size caps, content sniffing, HEAD verification |
| Secrets at rest | Integration secrets AES-256-GCM via `INTEGRATION_SECRET_KEY` |
| Audit | `AuditLog`, 24 months live then `ArchivedAuditLog` |

### Headers and CSP

Set in `next.config.mjs`; the policy itself lives in `lib/csp.mjs`.

`X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` ·
`Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy` ·
`Reporting-Endpoints` · `Content-Security-Policy-Report-Only`

**CSP status:** Report-Only, and now actually reporting — it previously named no endpoint at
all, so it neither blocked nor recorded.

| Directive | State |
|---|---|
| `'unsafe-eval'` | Removed in production; kept in development (Next's HMR evaluates strings) |
| `script-src 'unsafe-inline'` | Still required — Next's RSC payload scripts. Needs a middleware nonce. |
| `style-src 'unsafe-inline'` | Likely permanent — inline `style=` attributes, which nonces do not cover |

Violations post to `/api/csp-report`, are redacted at the point of logging
(`sanitizeUrl` in `lib/csp-report.ts`), and are read back with `pnpm csp:violations`.

> Redaction is not optional. `/track/<token>`, `/invoice/<code>` and `/receipt/<code>` carry
> bearer credentials in the path, so a raw violation URL is a credential.

---

## 4. Hosting and deployment

### Infrastructure

Self-hosted VPS (Hostinger). Nginx reverse proxy → Next.js; Supervisor manages processes.

| Item | Location |
|---|---|
| App | `/srv/ethree10/ethree10` |
| Deploy script | `/srv/ethree10/deploy.sh` — **not in version control** (see §7) |
| Environment | `/srv/ethree10/ethree10/.env` |
| Logs | `/var/log/ethree10/web.log`, `worker.log` |
| Processes | `ethree10-web`, `ethree10-worker` |

### Pipeline

Push to `main` → **CI** → on success → **Deploy** (`workflow_run`).

CI jobs: Type Check · Lint · Unit Tests · Integration Tests · E2E Tests · Docs Tests ·
Build · Dependency Audit · Launch Readiness.

Deploy runs `deploy.sh`, then four post-deploy gates: readiness, smoke, security headers,
backups. **A failure in any gate fails the deploy visibly** — it does not roll back.

Builds are atomic (`scripts/build-atomic.mjs`): build into a staging directory, swap only on
success, so a failed build cannot take production down.

### Dependency ratchet

`security-baseline.json` records the current advisory counts. CI fails if they rise; the
`--update` flag only ever lowers them. A new advisory published upstream turns CI red with no
change on our side — that is the ratchet working.

### Operational workflows

Manual `workflow_dispatch`, all read-only unless stated:

`backup-diagnostics` · `backup-run` · `backup-verify-restore` · `bootstrap-catalog` ·
`memberships` (writes) · `merge-branches` (writes) · `ops-report` · `assign-branch-heads` ·
`csp-violations`

> **10 of the 11 workflows hold root SSH to production** — everything except `ci.yml`.
> Each is individually guarded, but the aggregate is a growing blast radius reachable by
> anyone who can dispatch an Action. Worth restricting dispatch, or moving to a non-root
> user with a narrow sudo grant.

---

## 5. Constraints

| Constraint | Consequence |
|---|---|
| **One agency, no tenancy** | No `workspaceId`. Multi-tenant would be a rewrite. |
| **Clients have no accounts** | All client access is by bearer-token URL. |
| **`Membership @@unique([userId, role, teamId, subUnitId])`** | Does **not** include `removedAt`. Re-inviting someone to a role they previously held collides — handled by reviving the removed row. |
| **Soft deletes throughout** | `removedAt`, `deactivatedAt`, `archivedAt`. Queries must filter. |
| **No MFA** | Removed. Schema residue remains. |
| **`db push` is banned** | Against any shared or production database. Migrations only; history baselined 2026-08-09. |
| **Node 24** | Declared in `package.json` engines. |

---

## 6. Non-functional requirements

| Area | Requirement | Current |
|---|---|---|
| Availability | Best-effort; no formal SLA | Single VPS, single region |
| Backups | Database and uploads, restore-verified | ✅ Running, verified — **but off-site is missing** |
| Recovery | Restore provable, not assumed | ✅ `backup-verify-restore` |
| Observability | Errors reach a person | ❌ `SENTRY_DSN` unset |
| Audit retention | 24 months live, archive beyond | ✅ |
| Test coverage | Every safety rule has a test | ✅ 262 unit, integration, E2E, docs |
| Accessibility | WCAG 2.1 AA intent | Partial — see [04](04-UI-UX-Design-Brief.md#7-accessibility) |
| Performance | No formal budget | Not measured |

---

## 7. Technical debt

| Item | Why it matters |
|---|---|
| `deploy.sh` not in version control | The script that puts code on production cannot be reviewed, diffed or restored |
| `Team` / `SubUnit` naming | Models named for a model the product abandoned; every reader pays the translation cost |
| MFA residue | Three unused columns and router methods that throw |
| `super_admin` dual model | Boolean plus an empty permissions entry — two mechanisms for one idea |
| Eleven root-SSH workflows | Aggregate blast radius |
| CSP not enforced | Report-Only until real traffic produces a sample |
| 5 open Dependabot PRs | Two are major bumps (Tailwind 4, BullMQ 6) needing review, not merge |

---

## Related documents

- [01-PRD.md](01-PRD.md) · [03-App-Flow.md](03-App-Flow.md) · [04-UI-UX-Design-Brief.md](04-UI-UX-Design-Brief.md) · [05-Backend-Schema.md](05-Backend-Schema.md) · [06-Implementation-Plan.md](06-Implementation-Plan.md)
- [deployment.md](deployment.md) · [operations-runbook.md](operations-runbook.md) · [monitoring.md](monitoring.md) · [data-governance.md](data-governance.md) · [migration-baseline-runbook.md](migration-baseline-runbook.md)
