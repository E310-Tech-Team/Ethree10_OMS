/**
 * Propose an assignee for a task, or list who could take it.
 *
 * Assignment is deliberately two-step: someone proposes, a branch head decides.
 * A proposal is NOT an assignment, and a task with a proposal pending still
 * shows as unassigned to everyone except the person who made it. This script
 * goes through AssignmentService rather than writing `assigneeUserId`
 * directly, so the eligibility rules, the approval step, the audit entry and
 * the notification all happen exactly as they would in the app.
 *
 *   pnpm assign:task --task TSK-2026-00001
 *     Lists the task and everyone eligible. Writes nothing.
 *
 *   pnpm assign:task --task TSK-2026-00001 --to someone@r4cglobal.org --by me@r4cglobal.org
 *     Dry run: says what it would do.
 *
 *   pnpm assign:task --task ... --to ... --by ... --execute
 *     Proposes. Auto-approves only if the proposer could have approved it
 *     anyway — the service decides that, not this script.
 */
import { PrismaClient } from "@prisma/client";
import { AssignmentService } from "@/server/services/assignment";

const db = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const taskCode = arg("task");
  if (!taskCode) {
    console.log("Usage: pnpm assign:task --task TSK-YYYY-NNNNN [--to email --by email [--execute]]");
    process.exitCode = 1;
    return;
  }

  const task = await db.task.findUnique({
    where: { code: taskCode },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      assigneeUserId: true,
      subUnitId: true,
      project: { select: { code: true, name: true, agencyTeamId: true, team: { select: { name: true } } } },
    },
  });
  if (!task) {
    console.log(`No task with code ${taskCode}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`TASK ${task.code} — ${task.title}`);
  console.log(`  project: ${task.project.code} · ${task.project.name}`);
  console.log(`  branch:  ${task.project.team?.name ?? "UNROUTED"}`);
  console.log(`  status:  ${task.status}`);

  if (task.assigneeUserId) {
    const current = await db.user.findUnique({
      where: { id: task.assigneeUserId },
      select: { email: true },
    });
    console.log(`  assignee: ${current?.email ?? task.assigneeUserId}`);
  } else {
    console.log("  assignee: NONE");
  }

  // The contributor rows, which are what /team/assignments and /team/reviews
  // actually render. A task can have an assigneeUserId and no contributor row,
  // and those pages then show it as "Unassigned" while the task detail page
  // shows it assigned.
  const contributors = await db.taskContributor.findMany({
    where: { taskId: task.id, removedAt: null },
    select: { contributionRole: true, isPrimary: true, user: { select: { email: true } } },
    orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
  });
  console.log(`  contributors: ${contributors.length}`);
  for (const c of contributors) {
    console.log(`     ${c.user.email} · ${c.contributionRole}${c.isPrimary ? " · PRIMARY" : ""}`);
  }
  if (task.assigneeUserId && contributors.length === 0) {
    console.log(
      "     ^ ASSIGNED BUT NO CONTRIBUTOR ROW. /team/assignments and" +
        "\n       /team/reviews read contributors, so they show this task as" +
        "\n       Unassigned. Run with --repair-contributors --execute to fix.",
    );
  }

  // A pending proposal is the state most often mistaken for "assigned".
  const pending = await AssignmentService.pendingFor(task.id);
  if (pending) {
    const who = await db.user.findUnique({
      where: { id: pending.assigneeId },
      select: { email: true },
    });
    console.log(
      `\n  A PROPOSAL IS ALREADY PENDING for ${who?.email ?? pending.assigneeId}.` +
        `\n  It is not an assignment until a branch head approves it at /team/assignments.`,
    );
  }

  const branchId = task.project.agencyTeamId;
  const candidates = await db.membership.findMany({
    where: {
      removedAt: null,
      acceptedAt: { not: null },
      teamId: branchId,
      user: { deactivatedAt: null },
    },
    select: {
      role: true,
      user: { select: { id: true, email: true, name: true } },
      subUnit: { select: { name: true } },
    },
    orderBy: { role: "asc" },
  });

  console.log(`\nWHO CAN TAKE IT (${candidates.length} in this branch)\n`);
  if (candidates.length === 0) {
    console.log("  Nobody. The project's branch has no accepted members.");
  }
  for (const c of candidates) {
    console.log(`  ${c.user.email}  —  ${c.role}${c.subUnit ? ` · ${c.subUnit.name}` : ""}`);
  }

  if (process.argv.includes("--repair-contributors")) {
    const orphans = await db.task.findMany({
      where: { assigneeUserId: { not: null }, contributors: { none: { removedAt: null } } },
      select: { id: true, code: true, assigneeUserId: true },
    });
    console.log(`\nTASKS ASSIGNED WITH NO CONTRIBUTOR ROW (${orphans.length})\n`);
    for (const orphan of orphans) console.log(`  ${orphan.code}`);
    if (orphans.length === 0) return;
    if (!EXECUTE) {
      console.log("\nDRY RUN — re-run with --execute to create the missing rows.");
      return;
    }
    for (const orphan of orphans) {
      await db.taskContributor.upsert({
        where: {
          taskId_userId_contributionRole: {
            taskId: orphan.id,
            userId: orphan.assigneeUserId!,
            contributionRole: "Primary contributor",
          },
        },
        update: { isPrimary: true, removedAt: null },
        create: {
          taskId: orphan.id,
          userId: orphan.assigneeUserId!,
          contributionRole: "Primary contributor",
          isPrimary: true,
        },
      });
    }
    console.log(`\nCreated ${orphans.length} contributor row(s).`);
    return;
  }

  const toEmail = arg("to");
  const byEmail = arg("by");
  if (!toEmail || !byEmail) {
    console.log("\nPass --to <email> --by <email> to propose. Nothing was written.");
    return;
  }

  const [assignee, actor] = await Promise.all([
    db.user.findUnique({ where: { email: toEmail }, select: { id: true, email: true } }),
    db.user.findUnique({ where: { email: byEmail }, select: { id: true, email: true } }),
  ]);
  if (!assignee) {
    console.log(`\nNo account for ${toEmail}.`);
    process.exitCode = 1;
    return;
  }
  if (!actor) {
    console.log(`\nNo account for ${byEmail}.`);
    process.exitCode = 1;
    return;
  }

  if (!EXECUTE) {
    console.log(
      `\nDRY RUN — would propose ${assignee.email} for ${task.code}, proposed by ${actor.email}.` +
        `\nRe-run with --execute to do it.`,
    );
    return;
  }

  const result = await AssignmentService.propose({
    actorId: actor.id,
    taskId: task.id,
    assigneeId: assignee.id,
  });

  const after = await db.task.findUnique({
    where: { id: task.id },
    select: { assigneeUserId: true },
  });

  console.log(`\nProposed ${assignee.email} for ${task.code}.`);
  if (after?.assigneeUserId === assignee.id) {
    // propose() auto-approves when the proposer could have approved anyway.
    console.log("Auto-approved: the proposer holds approval on this branch, so the");
    console.log("task is now ASSIGNED. Making someone rubber-stamp their own proposal");
    console.log("would turn the approval step into a formality.");
  } else {
    console.log(`Status: ${result.status}. It is NOT assigned yet — a branch head`);
    console.log("decides at /team/assignments.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
