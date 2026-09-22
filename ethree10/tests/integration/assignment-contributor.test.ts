import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AssignmentService } from "@/server/services/assignment";
import type { Organization, Project, Request, Task, Team, User } from "@prisma/client";

/**
 * Two ways to assign a task must leave the same state.
 *
 * `TaskService.assign` has always upserted a "Primary contributor" row
 * alongside `assigneeUserId`. `AssignmentService.approve` — the two-step
 * propose/approve path the product documents as the correct flow — set only
 * `assigneeUserId`.
 *
 * That is not bookkeeping. /team/assignments and /team/reviews render
 * `task.contributors` and print "Unassigned" when the list is empty, so a task
 * assigned through the documented path showed as assigned on its own detail
 * page and as nobody's work on the branch's queues.
 *
 * Against a real database because the behaviour is a transaction writing two
 * tables; a mock would assert the mock.
 */
const stamp = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

describe("assignment keeps the contributor row in step", () => {
  const suffix = stamp();
  let org: Organization;
  let branch: Team;
  let head: User;
  let member: User;
  let request: Request;
  let project: Project;
  let task: Task;

  beforeAll(async () => {
    org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
    branch = await db.team.create({ data: { name: `Branch ${suffix}`, slug: `b-${suffix}` } });

    head = await db.user.create({ data: { email: `head-${suffix}@e.com`, name: "Head" } });
    member = await db.user.create({ data: { email: `member-${suffix}@e.com`, name: "Member" } });
    await db.membership.create({
      data: { userId: head.id, role: "branch_head", teamId: branch.id, acceptedAt: new Date() },
    });
    await db.membership.create({
      data: { userId: member.id, role: "team_member", teamId: branch.id, acceptedAt: new Date() },
    });

    request = await db.request.create({
      data: {
        code: `REQ-${suffix}`,
        title: "Fixture",
        description: "Fixture request.",
        projectType: "general",
        organizationId: org.id,
        routedTeamId: branch.id,
        submittedById: head.id,
        stage: "in_progress",
      },
    });
    project = await db.project.create({
      data: {
        code: `PRJ-${suffix}`,
        name: "Fixture project",
        requestId: request.id,
        organizationId: org.id,
        agencyTeamId: branch.id,
      },
    });
    task = await db.task.create({
      data: { code: `TSK-${suffix}`, title: "Fixture task", projectId: project.id },
    });
  });

  afterAll(async () => {
    const userIds = [head?.id, member?.id].filter(Boolean) as string[];
    await db.taskContributor.deleteMany({ where: { taskId: task?.id } });
    await db.taskAssignment.deleteMany({ where: { taskId: task?.id } });
    await db.task.deleteMany({ where: { id: task?.id } });
    await db.project.deleteMany({ where: { id: project?.id } });
    await db.request.deleteMany({ where: { id: request?.id } });
    await db.membership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.team.deleteMany({ where: { id: branch.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
  });

  it("starts with no contributor row", async () => {
    const before = await db.taskContributor.count({ where: { taskId: task.id } });
    expect(before).toBe(0);
  });

  it("creates the primary contributor when a proposal is approved", async () => {
    // The branch head proposes, so propose() auto-approves — the same path the
    // ops workflow takes, and the one that left the row missing.
    await AssignmentService.propose({
      actorId: head.id,
      taskId: task.id,
      assigneeId: member.id,
    });

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeUserId).toBe(member.id);

    const contributors = await db.taskContributor.findMany({
      where: { taskId: task.id, removedAt: null },
    });
    expect(contributors).toHaveLength(1);
    expect(contributors[0]!.userId).toBe(member.id);
    expect(contributors[0]!.isPrimary).toBe(true);
  });

  it("leaves exactly one primary when the task is reassigned", async () => {
    // Two primaries would make "who owns this" ambiguous, and the queues render
    // the primary first.
    await AssignmentService.propose({
      actorId: head.id,
      taskId: task.id,
      assigneeId: head.id,
    });

    const contributors = await db.taskContributor.findMany({
      where: { taskId: task.id, removedAt: null },
    });
    const primaries = contributors.filter((c) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.userId).toBe(head.id);

    // The previous assignee stays on the task as a contributor rather than
    // being erased — they did the work up to that point.
    expect(contributors.some((c) => c.userId === member.id)).toBe(true);
  });

  it("agrees with assigneeUserId", async () => {
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const primary = await db.taskContributor.findFirst({
      where: { taskId: task.id, removedAt: null, isPrimary: true },
    });
    // The invariant the branch queues depend on.
    expect(primary?.userId).toBe(after.assigneeUserId);
  });
});
