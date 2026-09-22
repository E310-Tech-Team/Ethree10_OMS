/**
 * Walk the money path on a fixture that deletes itself.
 *
 * Budget → invoice → payment → receipt → expense has never run in production:
 * zero invoices, zero receipts. It is the most carefully written part of this
 * platform and the least exercised, which is an uncomfortable combination for
 * the part that handles money.
 *
 * The valuable assertions here are the NEGATIVE ones. A happy path proves the
 * code runs; it does not prove the governance holds. So this deliberately tries
 * the things that must fail:
 *
 *   - a branch head issuing an invoice at all
 *   - sending an invoice with no budget behind it
 *   - sending one whose budget is submitted but not yet approved
 *   - Finance approving the budget they will later be paid against
 *   - the Chief Executive who approved the budget confirming its payment
 *   - confirming the same payment twice
 *   - spending past the approved envelope
 *   - a requester paying their own expense
 *
 * If any of those succeed, the separation of duties this agency depends on is
 * decorative — worth knowing before real money moves rather than after.
 *
 * Three disposable users, because the rules require three different people:
 * `chief_executive` and `finance_manager` are mutually exclusive by design, and
 * the approver may not be the confirmer.
 *
 * Paystack is not configured, so payment is confirmed as a bank transfer, which
 * is the path Finance would actually use today anyway.
 *
 *   pnpm probe:money            report what it would do
 *   pnpm probe:money --execute  run it, then clean up
 *   pnpm probe:money --keep     run it and leave the rows for inspection
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { RequestService } from "@/server/services/request";
import { BudgetService } from "@/server/services/budget";
import { DelegationService } from "@/server/services/delegation";
import { requireAgencyAction } from "@/server/services/agency";
import { allocateRandomCode } from "@/server/services/code-allocator";
import { secureCode } from "@/server/security/secure-code";

const db = new PrismaClient();
const EXECUTE = process.argv.includes("--execute");
const KEEP = process.argv.includes("--keep");
const NOTIFY_STAFF = process.argv.includes("--notify-staff");

const stamp = Date.now().toString(36);
/** Undeliverable by RFC 2606. Nothing leaves the building. */
const DOMAIN = "probe.invalid";

let passed = 0;
let failed = 0;

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`  ✓ ${name} — ${await fn()}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name} — ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

/** Asserts the call is REFUSED. A pass here means the guard held. */
async function mustRefuse(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failed += 1;
    console.log(`  ✗ ${name}\n      IT WAS ALLOWED. This guard is not holding.`);
  } catch (error) {
    passed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ✓ ${name}\n      refused: ${message.split("\n")[0]!.slice(0, 96)}`);
  }
}

/**
 * Who, other than the fixture, hears about this.
 *
 * Money notifications are deliberately wide: `moneyOversight` is every Chief
 * Executive, COO and Finance manager in the agency, and every one of these
 * kinds emails by default. So on a populated database this probe does not stay
 * inside its fixture — it tells real people that ₦150,000 landed against an
 * invoice that will not exist a second later.
 *
 * The rows are deleted afterwards, but an email cannot be unsent. So the probe
 * names the people it would reach and stops, unless told to go ahead.
 */
async function preflight(strict: boolean) {
  const memberships = await db.membership.findMany({
    where: {
      role: { in: ["chief_executive", "chief_operating_officer", "finance_manager"] },
      removedAt: null,
      acceptedAt: { not: null },
    },
    select: { role: true, user: { select: { email: true, deactivatedAt: true } } },
  });
  const staff = memberships.filter(
    (m) => !m.user.deactivatedAt && !m.user.email.endsWith(`@${DOMAIN}`),
  );
  if (staff.length === 0) {
    console.log("\nNo real finance or executive accounts here, so nothing leaves the fixture.");
    return;
  }

  console.log(`\nThis will email ${staff.length} real ${staff.length === 1 ? "person" : "people"}:\n`);
  for (const m of staff) console.log(`  ${m.user.email} · ${m.role}`);
  console.log(
    "\nThey would be told a payment was received and a receipt issued, for an\n" +
      "invoice that is deleted seconds later. The in-app rows are cleaned up;\n" +
      "the emails cannot be.\n\n" +
      "Re-run with --notify-staff if that is acceptable, or run this against a\n" +
      "database with no real finance or executive accounts.",
  );
  if (strict && !NOTIFY_STAFF) {
    throw new Error("Stopped before notifying real staff.");
  }
  if (strict) console.log("\n--notify-staff given. Continuing.\n");
}

async function main() {
  if (!EXECUTE) {
    console.log("DRY RUN — would create a disposable client, project and three users on");
    console.log(`@${DOMAIN} (branch head, chief executive, finance, and one person`);
    console.log("holding both a branch and the Finance chequebook), then check that:");
    console.log("");
    console.log("  a branch head issuing an invoice            is REFUSED");
    console.log("  an invoice with no budget                   is REFUSED");
    console.log("  an invoice on an unapproved budget          is REFUSED");
    console.log("  Finance approving a budget                  is REFUSED");
    console.log("  a submitter approving their own budget      is REFUSED");
    console.log("  delegating budget approval to Finance       is REFUSED");
    console.log("  confirming the same payment twice           is REFUSED");
    console.log("  spending past the approved envelope         is REFUSED");
    console.log("  paying an expense you requested yourself    is REFUSED");
    console.log("");
    console.log("  The last three of those need someone wearing two hats, because");
    console.log("  RBAC refuses a single-role actor before the governance rule runs.");
    console.log("");
    console.log("  budget → invoice → payment → receipt → expense all work");
    console.log("  the receipt code is drawn from the CSPRNG");
    console.log("  invoice and receipt reconcile");
    console.log("");
    console.log("then delete every row. Re-run with --execute.");
    // Report the blast radius now, while it still costs nothing to find out.
    await preflight(false);
    return;
  }

  await preflight(true);

  // The delivery probe borrowed an existing branch. This one cannot: a budget
  // decision notifies `projectTeam`, which resolves the branch lead — so
  // borrowing would email a real person that a fictional ₦200,000 budget was
  // approved. A disposable branch resolves to nobody. It is visible in
  // navigation for the few seconds the probe runs.
  const branch = await db.team.create({
    data: { name: `Probe Branch ${stamp}`, slug: `probe-branch-${stamp}` },
    select: { id: true, name: true },
  });

  const org = await db.organization.create({
    data: { name: `Probe Money ${stamp}`, slug: `probe-money-${stamp}`, isExternal: true },
  });

  const mk = async (role: string, label: string, teamId: string | null) => {
    const user = await db.user.create({
      data: { email: `probe-${label}-${stamp}@${DOMAIN}`, name: `Probe ${label}` },
    });
    await db.membership.create({
      data: { userId: user.id, role: role as never, teamId, acceptedAt: new Date() },
    });
    return user;
  };

  // Three people, because the rules require three. chief_executive and
  // finance_manager are mutually exclusive per user, and the approver may not
  // confirm the payment — so no two of these roles can be collapsed.
  const lead = await mk("branch_head", "lead", branch.id);
  const ce = await mk("chief_executive", "ce", null);
  const finance = await mk("finance_manager", "finance", null);

  // Three of the guards in budget.ts cannot be reached by someone holding a
  // single role — RBAC refuses first, and a test that stops there proves only
  // that RBAC works. Reaching them needs people wearing two hats, which is
  // ordinary in an agency this size and which the model explicitly permits:
  // only [chief_executive, finance_manager] and [COO, finance_manager] are
  // mutually exclusive.
  //
  // The Chief Executive also runs a branch, so they can submit a budget and
  // then be refused approval of their own submission.
  await db.membership.create({
    data: { userId: ce.id, role: "branch_head", teamId: branch.id, acceptedAt: new Date() },
  });
  // Someone who both requests spend and holds the Finance chequebook.
  const dual = await mk("branch_head", "dual", branch.id);
  await db.membership.create({
    data: { userId: dual.id, role: "finance_manager", teamId: null, acceptedAt: new Date() },
  });

  console.log(
    `\nFixture on "${branch.name}" · lead, chief executive (also a branch head),\n` +
      `finance, and one person wearing both hats — all on @${DOMAIN}\n`,
  );

  let requestId = "";
  let projectId = "";
  let budgetId = "";
  let invoiceId = "";
  let expenseId = "";

  /**
   * What `invoices.markSent` does, in the order it does it: RBAC, then the
   * spending gate, then the write. There is no InvoiceService to call — the
   * router holds this logic inline — so this is a replica, and it has to be
   * kept in step with `server/trpc/routers/invoices.ts` by hand.
   */
  const markSent = async (actorId: string) => {
    await requireAgencyAction(actorId, "invoice.manage");
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { projectId: true },
    });
    await BudgetService.assertApproved(existing?.projectId);
    return db.invoice.update({
      where: { id: invoiceId },
      data: { status: "sent", issuedAt: new Date() },
    });
  };

  try {
    await step("set up a project to spend against", async () => {
      const request = await RequestService.create({
        actorId: lead.id,
        organizationId: org.id,
        input: {
          title: `Money probe ${stamp}`,
          description: "Disposable fixture proving the money path. Deleted immediately.",
          projectType: "general",
          urgency: "low",
        },
      });
      requestId = request.id;
      await RequestService.route({ actorId: lead.id, requestId, teamId: branch.id });
      await RequestService.approve({ actorId: lead.id, requestId });
      const project = await db.project.findFirstOrThrow({
        where: { requestId },
        select: { id: true, code: true },
      });
      projectId = project.id;
      return project.code;
    });

    await mustRefuse("a branch head may not issue invoices", () =>
      requireAgencyAction(lead.id, "invoice.manage"),
    );

    await step("Finance drafts an invoice", async () => {
      const invoice = await allocateRandomCode({
        generate: () => `INV-${secureCode()}`,
        create: (code) =>
          db.invoice.create({
            data: {
              code,
              organizationId: org.id,
              projectId,
              currency: "NGN",
              amount: new Prisma.Decimal(150_000),
              lineItems: [{ description: "Probe line", quantity: 1, unitPrice: 150_000 }],
              status: "draft",
            },
          }),
      });
      invoiceId = invoice.id;
      return `${invoice.code}, draft`;
    });

    await mustRefuse("THE GATE: send it with no budget at all", () => markSent(finance.id));

    await step("the branch head submits a budget", async () => {
      const budget = await BudgetService.submit(lead.id, {
        projectId,
        amount: 200_000,
        clientAmount: 150_000,
        internalAmount: 50_000,
        currency: "NGN",
      });
      budgetId = budget.id;
      return `${budget.status}, ₦${budget.amount.toString()} (₦${budget.internalAmount?.toString()} internal)`;
    });

    await mustRefuse("THE GATE: send it on a budget nobody has approved", () =>
      markSent(finance.id),
    );

    await mustRefuse("Finance does not hold budget.approve at all", () =>
      BudgetService.decide(finance.id, { budgetId, decision: "approved" }),
    );

    // The Chief Executive holds budget.approve, so this one gets past RBAC and
    // reaches the guard itself: a submitter may not approve their own figure,
    // even when they are the person the whole agency approves through.
    await step("the Chief Executive submits a revision of their own", async () => {
      const budget = await BudgetService.submit(ce.id, {
        projectId,
        amount: 200_000,
        clientAmount: 150_000,
        internalAmount: 50_000,
        currency: "NGN",
      });
      return `version ${budget.version}, ${budget.status}`;
    });

    await mustRefuse("SELF-APPROVAL: the submitter approves their own budget", () =>
      BudgetService.decide(ce.id, { budgetId, decision: "approved" }),
    );

    await step("the branch head resubmits, which clears any decision", async () => {
      const budget = await BudgetService.submit(lead.id, {
        projectId,
        amount: 200_000,
        clientAmount: 150_000,
        internalAmount: 50_000,
        currency: "NGN",
      });
      if (budget.decidedById) throw new Error("A revision carried an old approval forward.");
      return `version ${budget.version}, ${budget.status}, no decision attached`;
    });

    await step("the Chief Executive approves the budget", async () => {
      const budget = await BudgetService.decide(ce.id, {
        budgetId,
        decision: "approved",
        note: "Probe.",
      });
      return budget.status;
    });

    await step("the gate opens and Finance sends the invoice", async () => {
      const invoice = await markSent(finance.id);
      return `${invoice.code}, ${invoice.status}`;
    });

    await mustRefuse("the Chief Executive does not hold payment.confirm", () =>
      BudgetService.confirmInvoicePayment(ce.id, {
        invoiceId,
        paymentMethod: "bank_transfer",
        paymentRef: `PROBE-${stamp}`,
      }),
    );

    // `confirmInvoicePayment` refuses an actor who approved the budget. Nobody
    // can actually be in that position: budget.approve is the Chief Executive's
    // alone, payment.confirm is Finance's alone, and holding both roles is
    // blocked. The one remaining route in is a delegation — the Chief Executive
    // handing budget.approve to the Finance manager — and that is refused where
    // it is granted, which is the door this proves is locked. The check inside
    // confirmInvoicePayment is the bolt behind it.
    await mustRefuse("SEPARATION OF DUTIES: delegate budget approval to Finance", () =>
      DelegationService.grant({
        actorId: ce.id,
        delegateId: finance.id,
        reason: "Probe: attempting to create an approver who can also confirm payment.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    );

    await step("Finance confirms the funds landed", async () => {
      const { invoice, receipt } = await BudgetService.confirmInvoicePayment(finance.id, {
        invoiceId,
        paymentMethod: "bank_transfer",
        paymentRef: `PROBE-${stamp}`,
      });
      return `invoice ${invoice.status}, receipt ${receipt.code}`;
    });

    await step("the receipt issued itself, with an unguessable code", async () => {
      const receipt = await db.receipt.findUnique({ where: { invoiceId } });
      if (!receipt) throw new Error("No receipt was created.");
      // /receipt/<code> asks for nothing else, so the code is a bearer
      // credential and must come from the CSPRNG, not Math.random.
      if (!/^RCPT-[0-9A-HJKMNP-TV-Z]{12}$/.test(receipt.code)) {
        throw new Error(`Receipt code is not a 12-char Crockford code: ${receipt.code}`);
      }
      if (receipt.paymentMethod !== "bank_transfer") {
        throw new Error(`Receipt records ${receipt.paymentMethod}, not the method used.`);
      }
      return `${receipt.code}, ₦${receipt.amount.toString()}, bank transfer`;
    });

    await mustRefuse("IDEMPOTENCY: confirm the same payment a second time", () =>
      BudgetService.confirmInvoicePayment(finance.id, {
        invoiceId,
        paymentMethod: "bank_transfer",
        paymentRef: `PROBE-${stamp}`,
      }),
    );

    // The envelope is internalAmount (₦50,000), not the headline ₦200,000.
    await mustRefuse("THE ENVELOPE: request ₦60,000 against a ₦50,000 internal budget", () =>
      BudgetService.requestExpense(lead.id, {
        projectId,
        description: "Probe overspend",
        amount: 60_000,
      }),
    );

    // Requested by the person who also holds the chequebook, so the refusal
    // below has to come from the self-pay rule rather than from RBAC.
    await step("the dual-hatted member requests ₦10,000, inside the envelope", async () => {
      const expense = await BudgetService.requestExpense(dual.id, {
        projectId,
        description: "Probe expense",
        amount: 10_000,
      });
      expenseId = expense.id;
      return `${expense.status}, ₦${expense.amount.toString()}`;
    });

    await mustRefuse("SELF-PAY: they hold expense.pay, and pay their own request", () =>
      BudgetService.payExpense(dual.id, { expenseId, paymentRef: `PROBE-${stamp}` }),
    );

    await step("Finance pays the expense", async () => {
      const expense = await BudgetService.payExpense(finance.id, {
        expenseId,
        paymentRef: `PROBE-${stamp}`,
      });
      return expense.status;
    });

    await step("invoice and receipt reconcile", async () => {
      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const receipt = await db.receipt.findUniqueOrThrow({ where: { invoiceId } });
      if (!invoice.amount.equals(receipt.amount)) {
        throw new Error(`invoice ₦${invoice.amount} vs receipt ₦${receipt.amount}`);
      }
      if (invoice.paymentConfirmedById !== finance.id) {
        throw new Error("The confirmer on the invoice is not the person who confirmed it.");
      }
      if (!invoice.paymentConfirmedAt) throw new Error("paymentConfirmedAt is not set.");
      return "amounts agree, confirmer and timestamp recorded";
    });

    await step("the audit trail names who did what", async () => {
      const logs = await db.auditLog.findMany({
        where: { actorId: { in: [lead.id, ce.id, finance.id] } },
        select: { action: true, actorId: true },
      });
      const by = (id: string) => logs.filter((l) => l.actorId === id).map((l) => l.action);
      const approved = by(ce.id).includes("budget.approved");
      const confirmed = by(finance.id).includes("invoice.paymentConfirmed");
      if (!approved) throw new Error("No budget.approved logged against the Chief Executive.");
      if (!confirmed) throw new Error("No invoice.paymentConfirmed logged against Finance.");
      return `${logs.length} entries, approval and confirmation attributed separately`;
    });
  } finally {
    if (KEEP) {
      console.log(`\nLeft in place (--keep). Project ${projectId}, invoice ${invoiceId}.`);
    } else {
      await cleanup([lead.id, ce.id, finance.id, dual.id], org.id, requestId, projectId, branch.id);
      console.log("\nFixture deleted.");
    }
  }

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  if (failed) process.exitCode = 1;
}

async function cleanup(
  userIds: string[],
  orgId: string,
  requestId: string,
  projectId: string,
  branchId: string,
) {
  // Children before parents. The audit and notification rows go too — they
  // describe a project, an invoice and three people that no longer exist.
  // Read the ids before deleting the rows: the notifications that fan out to
  // real staff reference them, and after the delete there is nothing to match.
  const invoices = await db.invoice.findMany({
    where: { OR: [{ projectId: projectId || undefined }, { organizationId: orgId }] },
    select: { id: true },
  });
  const invoiceIds = invoices.map((i) => i.id);
  const receiptIds = (
    await db.receipt.findMany({
      where: { OR: [{ invoiceId: { in: invoiceIds } }, { organizationId: orgId }] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const expenseIds = projectId
    ? (await db.expense.findMany({ where: { projectId }, select: { id: true } })).map((e) => e.id)
    : [];
  const budgetIds = projectId
    ? (await db.budget.findMany({ where: { projectId }, select: { id: true } })).map((b) => b.id)
    : [];

  await db.receipt.deleteMany({ where: { id: { in: receiptIds } } });
  await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  if (projectId) {
    await db.expense.deleteMany({ where: { projectId } });
    await db.budgetDecision.deleteMany({ where: { budget: { projectId } } });
    await db.budget.deleteMany({ where: { projectId } });
    await db.task.deleteMany({ where: { projectId } });
  }
  if (requestId) await db.requestStageEvent.deleteMany({ where: { requestId } });
  if (projectId) await db.project.deleteMany({ where: { id: projectId } });
  if (requestId) await db.request.deleteMany({ where: { id: requestId } });
  // Money notifications fan out beyond the fixture — `moneyOversight` is every
  // Chief Executive, COO and Finance manager in the agency — so deleting only
  // the fixture users' rows would leave real people holding a bell for an
  // invoice that no longer exists. Every one of these carries the stamp in its
  // body or names an entity that has just been deleted.
  await db.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { body: { contains: stamp } },
        { title: { contains: stamp } },
        { entityType: "Invoice", entityId: { in: invoiceIds } },
        { entityType: "Receipt", entityId: { in: receiptIds } },
        { entityType: "Expense", entityId: { in: expenseIds } },
        { entityType: "Budget", entityId: { in: budgetIds } },
      ],
    },
  });
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.membership.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.team.deleteMany({ where: { id: branchId } });
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
