/**
 * Walk one task the whole way — assign, log time, submit completion, review,
 * deliver — on a fixture that is deleted afterwards.
 *
 * Why a fixture and not the live task: the back half of the delivery path has
 * never run in production, and it is the half that writes people's names into
 * the record. Walking the real task would log hours its assignee never worked,
 * record a completion they never submitted, and — at the `delivered` transition
 * — email the client that their work is done. Audit rows are permanent by
 * design and an email cannot be unsent, so the proof has to happen somewhere
 * disposable.
 *
 * Everything it touches, it owns:
 *   - two users on an undeliverable domain, so no real person is notified
 *   - a request with no requesterEmail and consentToEmail false, so the client
 *     email path is a no-op even if something tries
 *   - every row deleted at the end, including audit entries and notifications,
 *     because they are about a fixture that no longer exists
 *
 * It goes through the services, not raw writes. Writing the rows directly
 * would prove the database accepts them, which was never in question.
 *
 *   pnpm probe:delivery            report what it would do
 *   pnpm probe:delivery --execute  run it, then clean up
 *   pnpm probe:delivery --keep     run it and leave the rows for inspection
 */
import { PrismaClient } from "@prisma/client";
import { RequestService } from "@/server/services/request";
import { ProjectService } from "@/server/services/project";
import { TaskService } from "@/server/services/task";
import { AssignmentService } from "@/server/services/assignment";
import { TimeLogService } from "@/server/services/timeLog";

const db = new PrismaClient();
const EXECUTE = process.argv.includes("--execute");
const KEEP = process.argv.includes("--keep");

const stamp = `${Date.now().toString(36)}`;
/** Undeliverable by RFC 2606. Nothing leaves the building. */
const DOMAIN = "probe.invalid";

type Step = { name: string; ok: boolean; detail: string };
const steps: Step[] = [];

async function step(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail });
    console.log(`  ✓ ${name} — ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, detail });
    console.log(`  ✗ ${name} — ${detail}`);
    throw error;
  }
}

async function main() {
  if (!EXECUTE) {
    console.log("DRY RUN — would create a disposable request, project, task and two");
    console.log("users on @" + DOMAIN + ", walk them through:");
    console.log("  assign → log time → submit completion → review → done → delivered");
    console.log("then delete every row. Re-run with --execute.");
    return;
  }

  // The fixture needs a branch, because assignment eligibility is decided at
  // branch level. It borrows an existing one rather than creating a branch,
  // which would show up in everyone's navigation while it existed.
  const branch = await db.team.findFirst({
    where: { archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!branch) throw new Error("No branch exists to hang the fixture on.");

  const org = await db.organization.create({
    data: { name: `Probe Client ${stamp}`, slug: `probe-${stamp}`, isExternal: true },
  });

  const lead = await db.user.create({
    data: { email: `probe-lead-${stamp}@${DOMAIN}`, name: "Probe Lead" },
  });
  const member = await db.user.create({
    data: { email: `probe-member-${stamp}@${DOMAIN}`, name: "Probe Member" },
  });
  await db.membership.create({
    data: { userId: lead.id, role: "branch_head", teamId: branch.id, acceptedAt: new Date() },
  });
  await db.membership.create({
    data: { userId: member.id, role: "team_member", teamId: branch.id, acceptedAt: new Date() },
  });

  console.log(`\nFixture on branch "${branch.name}", users on @${DOMAIN}\n`);

  let requestId = "";
  let projectId = "";
  let taskId = "";

  try {
    await step("create request", async () => {
      const created = await RequestService.create({
        actorId: lead.id,
        organizationId: org.id,
        input: {
          title: `Probe ${stamp}`,
          description: "Disposable fixture proving the delivery path. Deleted immediately.",
          projectType: "general",
          urgency: "low",
        },
      });
      requestId = created.id;
      return created.code;
    });

    await step("route to branch", async () => {
      await RequestService.route({ actorId: lead.id, requestId, teamId: branch.id });
      return branch.name;
    });

    await step("accept request (creates the project)", async () => {
      await RequestService.approve({ actorId: lead.id, requestId });
      const project = await db.project.findFirst({ where: { requestId }, select: { id: true, code: true } });
      if (!project) throw new Error("Acceptance did not create a project.");
      projectId = project.id;
      return project.code;
    });

    await step("create task", async () => {
      const task = await TaskService.create({
        actorId: lead.id,
        input: { projectId, title: `Probe task ${stamp}`, acceptanceCriteria: "It runs." },
      });
      taskId = task.id;
      return task.code;
    });

    await step("assign (propose, auto-approved by the branch head)", async () => {
      await AssignmentService.propose({ actorId: lead.id, taskId, assigneeId: member.id });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const contributors = await db.taskContributor.count({ where: { taskId, removedAt: null } });
      if (after.assigneeUserId !== member.id) throw new Error("assigneeUserId was not set.");
      // The bug fixed today. If this regresses, the branch queues show the task
      // as nobody's while the detail page shows it assigned.
      if (contributors !== 1) throw new Error(`expected 1 contributor row, got ${contributors}`);
      return `assignee set, ${contributors} contributor row`;
    });

    await step("log time", async () => {
      await TimeLogService.addTimeLog({
        actorId: member.id,
        taskId,
        hours: 2.5,
        note: "Probe",
        date: new Date(),
      });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      return `loggedHours = ${after.loggedHours.toString()}`;
    });

    await step("submit completion", async () => {
      await TaskService.submitCompletion({
        actorId: member.id,
        taskId,
        summary: "Probe completion.",
        evidence: "n/a",
      });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      if (after.status !== "in_review") throw new Error(`status is ${after.status}, expected in_review`);
      return "status = in_review";
    });

    await step("review and accept", async () => {
      await TaskService.review({ actorId: lead.id, taskId, decision: "accept", note: "Probe." });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      if (after.status !== "done") throw new Error(`status is ${after.status}, expected done`);
      return "status = done";
    });

    // approved -> in_progress -> in_review -> delivered. The probe originally
    // jumped from approved straight to in_review and the app refused it, which
    // is the transition table doing its job: a request cannot be under review
    // before anyone has started work on it.
    await step("request → in_progress", async () => {
      await RequestService.transition({ actorId: lead.id, requestId, toStage: "in_progress" });
      return "in_progress";
    });

    await step("request → in_review", async () => {
      await RequestService.transition({ actorId: lead.id, requestId, toStage: "in_review" });
      return "in_review";
    });

    await step("request → delivered", async () => {
      await RequestService.transition({ actorId: lead.id, requestId, toStage: "delivered" });
      const after = await db.request.findUniqueOrThrow({ where: { id: requestId } });
      return after.stage;
    });
  } finally {
    if (KEEP) {
      console.log(`\nLeft in place (--keep). Request ${requestId}, project ${projectId}, task ${taskId}.`);
    } else {
      await cleanup([lead.id, member.id], org.id, requestId, projectId, taskId);
      console.log("\nFixture deleted.");
    }
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed.`);
  if (failed.length) process.exitCode = 1;
}

async function cleanup(
  userIds: string[],
  orgId: string,
  requestId: string,
  projectId: string,
  taskId: string,
) {
  // Order matters: children before parents, and the fixture's audit and
  // notification rows go too — they describe something that no longer exists.
  if (taskId) {
    await db.timeLog.deleteMany({ where: { taskId } });
    await db.taskReview.deleteMany({ where: { taskId } });
    await db.taskAssignment.deleteMany({ where: { taskId } });
    await db.taskContributor.deleteMany({ where: { taskId } });
    await db.taskComment.deleteMany({ where: { taskId } });
  }
  if (projectId) await db.task.deleteMany({ where: { projectId } });
  if (requestId) {
    await db.requestStageEvent.deleteMany({ where: { requestId } });
    await db.taskComment.deleteMany({ where: { requestId } });
  }
  if (projectId) await db.project.deleteMany({ where: { id: projectId } });
  if (requestId) await db.request.deleteMany({ where: { id: requestId } });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.membership.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.organization.deleteMany({ where: { id: orgId } });
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
