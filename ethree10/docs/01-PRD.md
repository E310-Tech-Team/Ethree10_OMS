# 01 — Product Requirements Document

**Product:** Ethree10 OMS (E310)
**Owner:** Ethree10, a Reach4Christ Global initiative
**Status:** Live in production at https://oms.ethree10.com — see [§8 Reality check](#8-reality-check)
**Last updated:** 20 September 2026

---

## 1. Overview

Ethree10 is a creative and technology agency. The OMS is the single system it runs on: a
client asks for work, the agency scopes it, agrees a budget, assigns it to people, delivers
it, invoices for it, and reports on it.

The product exists because that chain previously lived across conversations, spreadsheets
and inboxes, where nobody could answer "who owns this and what happens next" without asking
several people.

**One agency, not a SaaS.** There is no tenant or workspace abstraction. Every staff query is
agency-global unless a role explicitly narrows it. This is a deliberate constraint and the
schema reflects it — see [02-TRD §5](02-TRD.md#5-constraints).

### The delivery chain

```
Request  →  Project  →  Task  →  Assignee  →  Deliverable  →  Invoice  →  Receipt
```

A break anywhere in this chain looks identical from the outside: nothing to do. Most of the
product's value is in making each link visible.

---

## 2. Goals

| # | Goal | How it is measured |
|---|---|---|
| G1 | Every client request has a visible owner and a next action | No request sits UNROUTED beyond its urgency threshold |
| G2 | Work can be given to a named person and tracked to completion | Tasks exist, are assigned, and reach `done` |
| G3 | Money cannot move without the right approvals | Budget gate + separation of duties, enforced in code |
| G4 | Clients can see progress without an account | Tracking link shows client-safe status only |
| G5 | Every consequential action is attributable | Audit trail covers role changes, stage moves, money |
| G6 | Staff can find their own work in one place | "My Work" answers what I do today |

### Non-goals

- **Not a client portal.** Clients have no accounts and never sign in.
- **Not multi-tenant.** One agency. Selling this as SaaS would be a rewrite.
- **Not a chat tool.** Comments attach to work items; conversation lives elsewhere.
- **No MFA.** It was removed deliberately; `/settings/security` says so.

---

## 3. Target users

Eight roles, defined in `server/auth/permissions.ts`. The permission model is the contract —
this table is a summary of it, not a second source of truth.

| Role | Who they are | What the product must let them do |
|---|---|---|
| `super_admin` | Technical platform owner | Escape hatch. Not an operational role. |
| `chief_executive` | Overall head | See everything; **the only role that may approve a budget**. No delivery writes. |
| `chief_operating_officer` | Second to the CE | Run operations agency-wide; reshape the agency. Never approves budgets by role. |
| `agency_admin` | Runs operations | People, services, routing, assignment, review. No money powers. |
| `finance_manager` | Money | Invoice, confirm payment, issue receipt, pay expenses. **May not approve budgets.** |
| `branch_head` | Heads a Branch | Full delivery authority inside their branch. |
| `department_lead` | Leads a Department | Assign and review their department's work. |
| `team_member` | Delivers the work | See and complete what they are assigned. |

**External users:** clients and prospects, who never authenticate. They submit a request from
the marketing site and follow a tracking link afterwards.

### Organisation shape

```
Agency  →  Branch (2)  →  Department (many)  →  People
```

Currently: **Digital Media** (16 members) and **Tech & Product** (7 members).

> **Naming trap.** In the schema a Branch is `Team` and a Department is `SubUnit`. The UI and
> roles use Branch/Department. Renaming the models is outstanding mechanical work.

---

## 4. Core features

### 4.1 Intake and triage
- Public request form on the marketing site — no login
- Requests get a code (`REQ-YYYY-NNNN`), urgency, and a routed Branch
- 14 lifecycle stages from `submitted` to `closed`
- Triage surfaces age against a per-urgency threshold (critical 1 day → low 14 days)
- Approval rules can require sign-off before work starts

### 4.2 Scoping and proposals
- Proposals drafted against a request, sent, accepted or rejected
- Service catalogue classifies the work and drives capability matching

### 4.3 Delivery
- Projects (`PRJ-YYYY-NNNN`) created from an approved request
- Tasks (`TSK-YYYY-NNNNN`) with status, priority, estimate, logged hours, dependencies
- **Assignment is a two-step proposal**: a lead proposes, a branch head approves
- Project templates apply a standard task set
- Deliverables with versions, and a review queue with an explicit decision
- Time logging against tasks

### 4.4 Money governance
This is the most safety-critical area. Two rules, both enforced in `server/services/budget.ts`:

1. **Approval gate** — no invoice sent and no expense paid until the Chief Executive has
   approved the project's budget.
2. **Separation of duties** — whoever approved the budget may never confirm the resulting
   payment; a requester may never pay their own expense.

Invoices, Paystack payment, receipts (idempotent, issued only by payment confirmation),
expenses, and time-boxed budget approval delegation.

### 4.5 Client visibility
- A tracking link is a **bearer credential**: whoever holds it sees client-safe status,
  public messages and approved deliverables — and nothing internal
- Public invoice and receipt pages, also code-addressed
- Client decisions (accept / request changes) recorded against the project

### 4.6 Reporting and oversight
- Weekly reports, generated on a schedule and exportable to PDF
- Contributions, amendments, scorecards, KPI snapshots
- Audit log, searchable for 24 months then archived
- Analytics dashboard

### 4.7 Platform
- Magic-link sign-in (Resend) and Google OAuth
- In-app, email and WhatsApp notifications
- File attachments via presigned upload straight to object storage
- Plane integration for task sync

---

## 5. User stories

**Intake**
- As a prospective client, I submit a brief without creating an account, and get a link to follow it.
- As a branch head, I see requests routed to my branch and how long each has waited.
- As an agency admin, I route an unrouted request to the branch that should own it.

**Delivery**
- As a department lead, I propose a member for a task based on their skills and current load.
- As a branch head, I approve or reject that proposal — nobody is given work behind my back.
- As a team member, I open "My Work" and see only what is mine, with what is due.
- As a reviewer, I approve a deliverable or return it with a required revision.

**Money**
- As the Chief Executive, I approve a project budget; nothing bills until I do.
- As a finance manager, I issue an invoice, confirm the payment, and the receipt issues itself.
- As an auditor, I can show who approved what and when.

**Client**
- As a client, I open my tracking link and see progress without seeing internal notes or budgets.
- As a client, I accept a deliverable or ask for a change.

---

## 6. Success metrics

Deliberately about **use**, not uptime. The platform being correct is necessary and not
sufficient — see [§8](#8-reality-check).

| Metric | Target | Source |
|---|---|---|
| Requests routed within their urgency threshold | > 90% | `lib/request-triage.ts` |
| Active projects with at least one task | **100%** | `pnpm ops:report` |
| Tasks with a named assignee | > 95% | `pnpm ops:report` |
| Assignment proposals resolved within 2 working days | > 90% | `TaskAssignment.status` |
| Invoices with a matching receipt | 100% | `pnpm check:reconciliation` |
| Budget-gate or separation-of-duties bypasses | **0** | `pnpm verify:governance` |
| Staff signing in weekly | > 70% of members | — |

---

## 7. Release gates

Enforced automatically on every deploy — see [02-TRD §4](02-TRD.md#4-hosting-and-deployment):

- `pnpm check:readiness:db` — production environment sanity
- `pnpm check:smoke` — the app actually answers
- `pnpm check:security-headers` — headers and CSP reporting intact
- `pnpm check:backups` — backups are fresh

---

## 8. Reality check

Documenting what is true rather than what is hoped, per the standard these docs are written to.

**Measured in production on 20 September 2026:**

| | |
|---|---|
| Branches | 2, both led |
| People with accounts | 23 |
| Requests | 6 |
| Projects | 3 active |
| **Tasks** | **0** |
| Invoices / receipts | 0 / 0 |

**The platform is built and unexercised.** Three projects are active — one 41 days old, one
37, one 12 — and none has a single task, so no one can be assigned anything. Three of six
requests are UNROUTED. All six are unclassified against a service catalogue that holds 27
rows.

Every feature in §4 exists in code and is covered by tests. The money governance in §4.4 has
never been exercised against a real invoice, because none has been raised.

**G2 and G6 are therefore unmet in practice**, and no amount of further engineering changes
that. The next meaningful step is operational: one real task, on one real project, assigned
to one real person.

---

## 9. Known gaps

| Gap | Status |
|---|---|
| Google OAuth credentials not set in production | Blocked on credentials; everything else is ready |
| Off-site backups | Backups run and restore-verify, but every copy is on the machine it protects |
| `SENTRY_DSN` unset | Error boundaries report nowhere |
| CSP not enforced | Report-Only; collection now works, needs real traffic first |
| MFA schema residue | `mfaEnabled` / `mfaSecret` / `mfaRecoveryCodes` unused; router methods throw |
| `super_admin` dual model | Granted by boolean, with an empty `ROLE_PERMISSIONS` entry |
| Model naming | `Team`/`SubUnit` still named for a model the product no longer uses |

---

## Related documents

- [02-TRD.md](02-TRD.md) — stack, hosting, integrations, constraints
- [03-App-Flow.md](03-App-Flow.md) — every screen and the flows between them
- [04-UI-UX-Design-Brief.md](04-UI-UX-Design-Brief.md) — design direction
- [05-Backend-Schema.md](05-Backend-Schema.md) — data model and API surface
- [06-Implementation-Plan.md](06-Implementation-Plan.md) — what is built and what is next
- [`../../GOVERNANCE-AND-JOURNEYS.md`](../../GOVERNANCE-AND-JOURNEYS.md) — full governance model and per-role journeys
