import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { appRouter } from "@/server/trpc/routers/_app";
import { createCallerFactory } from "@/server/trpc/trpc";
import { createAuthorize } from "@/server/trpc/context";
import type { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import type { Organization, Project, Request, Task, Team, User } from "@prisma/client";

/**
 * Procedures that shipped with no authorization at all.
 *
 * `timeLogs` had three: `listForUser` took a userId straight from the caller and
 * returned that person's whole timesheet to anyone signed in, `listForTask` did
 * the same for any task in the agency, and `add` let anyone move any task's
 * logged hours. `attachments.list` resolved its parent without an actor, so any
 * task's or request's files could be listed by id.
 *
 * Every test below calls the real procedure as a real user against a real
 * database. Each one fails against the previous code — that is the point of
 * them; asserting that a permission table contains a string proves nothing
 * about whether the procedure consults it.
 */
const createCaller = createCallerFactory(appRouter);

const stamp = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

/**
 * The real authorize, not a stub. A test that injects `authorize: async () => {}`
 * cannot tell a guarded procedure from an unguarded one.
 */
function getCaller(userId: string) {
  return createCaller({
    db,
    userId,
    session: { user: { id: userId } } as Session,
    headers: new Headers(),
    authorize: createAuthorize(userId),
  } as never);
}

const code = (err: unknown) => (err as TRPCError).code;

describe("procedures that had no authorization", () => {
  const suffix = stamp();
  let org: Organization;
  let branchA: Team;
  let branchB: Team;
  /** Branch head of A, so branch-scoped: holds report.read for A only. */
  let headA: User;
  /** Branch head of B. Same permissions, different branch. */
  let headB: User;
  /** Plain member of A: no report.read at all. */
  let memberA: User;
  let requestA: Request;
  let projectA: Project;
  let taskA: Task;
  let looseRequest: Request;

  async function makeUser(email: string, role: string, teamId: string) {
    const user = await db.user.create({ data: { email, name: email.split("@")[0]! } });
    await db.membership.create({
      data: { userId: user.id, role: role as never, teamId, acceptedAt: new Date() },
    });
    return user;
  }

  beforeAll(async () => {
    org = await db.organization.create({
      data: { name: `Org ${suffix}`, slug: `org-${suffix}` },
    });
    branchA = await db.team.create({ data: { name: `A ${suffix}`, slug: `a-${suffix}` } });
    branchB = await db.team.create({ data: { name: `B ${suffix}`, slug: `b-${suffix}` } });

    headA = await makeUser(`head-a-${suffix}@ethree10.com`, "branch_head", branchA.id);
    headB = await makeUser(`head-b-${suffix}@ethree10.com`, "branch_head", branchB.id);
    memberA = await makeUser(`member-a-${suffix}@ethree10.com`, "team_member", branchA.id);

    requestA = await db.request.create({
      data: {
        code: `REQ-${suffix}`,
        title: "Branch A work",
        description: "Belongs to branch A and nobody else.",
        projectType: "general",
        organizationId: org.id,
        routedTeamId: branchA.id,
        submittedById: headA.id,
        stage: "in_progress",
        urgency: "medium",
      },
    });
    projectA = await db.project.create({
      data: {
        code: `PRJ-${suffix}`,
        name: "Branch A project",
        requestId: requestA.id,
        organizationId: org.id,
        agencyTeamId: branchA.id,
      },
    });
    looseRequest = await db.request.create({
      data: {
        code: `REQ-LOOSE-${suffix}`,
        title: "Untriaged",
        description: "Not yet routed to any branch.",
        projectType: "general",
        organizationId: org.id,
        submittedById: headA.id,
      },
    });
    taskA = await db.task.create({
      data: { code: `TSK-${suffix}`, title: "Branch A task", projectId: projectA.id },
    });
    await db.timeLog.create({
      data: { taskId: taskA.id, userId: memberA.id, hours: 3, date: new Date() },
    });
  });

  afterAll(async () => {
    const userIds = [headA?.id, headB?.id, memberA?.id].filter(Boolean) as string[];
    await db.timeLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.task.deleteMany({ where: { code: { contains: suffix } } });
    await db.project.deleteMany({ where: { code: { contains: suffix } } });
    await db.request.deleteMany({ where: { code: { contains: suffix } } });
    await db.membership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.team.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
    await db.organization.deleteMany({ where: { id: org.id } });
  });

  describe("timeLogs.listForUser", () => {
    it("lets anyone read their own timesheet", async () => {
      // A team member holds no reporting permission and must still see their own.
      const logs = await getCaller(memberA.id).timeLogs.listForUser({ userId: memberA.id });
      expect(logs).toHaveLength(1);
    });

    it("refuses a colleague's timesheet to a peer", async () => {
      // The original hole, stated plainly: memberA and headA are in the same
      // branch, but a team member has no business reading anyone else's hours.
      const err = await getCaller(memberA.id)
        .timeLogs.listForUser({ userId: headA.id })
        .catch((e) => e);
      expect(code(err)).toBe("FORBIDDEN");
    });

    it("lets a branch head read their own member's timesheet", async () => {
      const logs = await getCaller(headA.id).timeLogs.listForUser({ userId: memberA.id });
      expect(logs).toHaveLength(1);
    });

    it("refuses a branch head someone in another branch", async () => {
      // headB holds report.read — for branch B. Permission is not a passport.
      const err = await getCaller(headB.id)
        .timeLogs.listForUser({ userId: memberA.id })
        .catch((e) => e);
      expect(code(err)).toBe("NOT_FOUND");
    });
  });

  describe("timeLogs.listForTask", () => {
    it("lets a member of the owning branch read it", async () => {
      const logs = await getCaller(memberA.id).timeLogs.listForTask(taskA.id);
      expect(logs).toHaveLength(1);
    });

    it("refuses a task belonging to another branch", async () => {
      const err = await getCaller(headB.id).timeLogs.listForTask(taskA.id).catch((e) => e);
      expect(code(err)).toBe("NOT_FOUND");
    });

    it("does not confirm that an out-of-scope task exists", async () => {
      // A real id the caller may not see and an id that does not exist must be
      // indistinguishable, or the error itself enumerates the agency's work.
      const real = await getCaller(headB.id).timeLogs.listForTask(taskA.id).catch((e) => e);
      const fake = await getCaller(headB.id).timeLogs.listForTask("does-not-exist").catch((e) => e);
      expect(code(real)).toBe(code(fake));
      expect((real as TRPCError).message).toBe((fake as TRPCError).message);
    });
  });

  describe("timeLogs.add", () => {
    it("refuses hours against another branch's task", async () => {
      // This moved the task's loggedHours, so it skewed reported effort on work
      // the caller could not even see.
      const err = await getCaller(headB.id)
        .timeLogs.add({ taskId: taskA.id, hours: 5, date: new Date() })
        .catch((e) => e);
      expect(code(err)).toBe("NOT_FOUND");

      const after = await db.task.findUniqueOrThrow({ where: { id: taskA.id } });
      expect(after.loggedHours.toNumber()).toBe(0);
    });

    it("still lets the owning branch log time", async () => {
      await getCaller(memberA.id).timeLogs.add({ taskId: taskA.id, hours: 2, date: new Date() });
      const after = await db.task.findUniqueOrThrow({ where: { id: taskA.id } });
      expect(after.loggedHours.toNumber()).toBe(2);
    });
  });

  describe("work that belongs to no branch", () => {
    it("is reachable by anyone holding the action", async () => {
      // A request before triage, or a project before it is given to a branch,
      // belongs to nobody. Treating that as "every branch is excluded" locks
      // everyone out of normal early-stage work instead of protecting anything.
      // This is the case that made the existing attachment fixtures fail when
      // the rule was first written the other way round.
      const loose = await db.project.create({
        data: {
          code: `PRJ-LOOSE-${suffix}`,
          name: "Unassigned project",
          requestId: looseRequest.id,
          organizationId: org.id,
          agencyTeamId: null,
        },
      });
      const looseTask = await db.task.create({
        data: { code: `TSK-LOOSE-${suffix}`, title: "Unassigned task", projectId: loose.id },
      });

      await expect(getCaller(headB.id).timeLogs.listForTask(looseTask.id)).resolves.toEqual([]);
    });
  });

  describe("attachments.list", () => {
    it("refuses a task in another branch", async () => {
      const err = await getCaller(headB.id)
        .attachments.list({ taskId: taskA.id })
        .catch((e) => e);
      expect(code(err)).toBe("NOT_FOUND");
    });

    it("refuses a request in another branch", async () => {
      const err = await getCaller(headB.id)
        .attachments.list({ requestId: requestA.id })
        .catch((e) => e);
      expect(code(err)).toBe("NOT_FOUND");
    });

    it("allows the owning branch", async () => {
      await expect(
        getCaller(headA.id).attachments.list({ requestId: requestA.id }),
      ).resolves.toEqual([]);
    });
  });
});
