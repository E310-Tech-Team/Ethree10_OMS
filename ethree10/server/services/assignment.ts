import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db/client";
import { AuditService } from "@/server/services/audit";
import { NotificationService } from "@/server/services/notification";
import { getAgencyAuthContext, requireAgencyAction } from "@/server/services/agency";
import { can } from "@/server/auth/permissions";
import {
  canDecideAssignment,
  checkAssignmentEligibility,
} from "@/server/services/assignment-eligibility";
import { buildRationale, rankCandidates } from "@/server/services/assignee-ranking";

/**
 * Proposing work, and the branch head deciding on it.
 *
 * `Task.assigneeUserId` is written **only** when an assignment is approved, so
 * a proposal genuinely holds the work rather than merely annotating it. That is
 * the point of the feature: approval that does not gate anything is theatre,
 * and work started before approval is work the branch head cannot really refuse.
 *
 * Step 3 of docs/service-assignment-plan.md.
 */

interface ProposeArgs {
  actorId: string | null;
  taskId: string;
  assigneeId: string;
  rationale?: Prisma.InputJsonValue;
}

async function loadTaskForAssignment(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { agencyTeamId: true } } },
  });
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
  return task;
}

/**
 * Whether this person may decide assignments on this branch.
 *
 * Holding `task.assignmentApprove` is necessary but not sufficient: a branch
 * head may only decide on their own branch. Agency-wide holders (COO, Agency
 * Admin) are not tied to a branch and may decide anywhere.
 */
async function canDecideForBranch(userId: string, branchId: string | null): Promise<boolean> {
  const ctx = await getAgencyAuthContext(userId);
  const memberships = await db.membership.findMany({
    where: { userId, removedAt: null, acceptedAt: { not: null } },
    select: { teamId: true },
  });
  return canDecideAssignment({
    holdsApprovePermission: can(ctx, "task.assignmentApprove"),
    isSuperAdmin: ctx.isSuperAdmin,
    approverBranchIds: memberships
      .map((m) => m.teamId)
      .filter((id): id is string => Boolean(id)),
    taskBranchId: branchId,
  });
}

export class AssignmentService {
  /** The proposal currently awaiting a decision on a task, if any. */
  static async pendingFor(taskId: string) {
    return db.taskAssignment.findFirst({
      where: { taskId, status: "proposed" },
      include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { proposedAt: "desc" },
    });
  }

  /** Everything awaiting a decision, for the branch head's approval queue. */
  static async pendingForBranch(branchId: string | null) {
    return db.taskAssignment.findMany({
      where: {
        status: "proposed",
        ...(branchId ? { task: { project: { agencyTeamId: branchId } } } : {}),
      },
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            dueDate: true,
            priority: true,
            service: { select: { name: true } },
            project: { select: { id: true, name: true, agencyTeamId: true } },
          },
        },
      },
      orderBy: { proposedAt: "asc" },
    });
  }

  /**
   * Propose someone for a task.
   *
   * Auto-approves when the proposer could have approved it anyway. Making a
   * branch head approve their own proposal is the fastest way to turn the whole
   * step into a rubber stamp — approval exists for proposals they did not make.
   */
  static async propose(args: ProposeArgs) {
    const task = await loadTaskForAssignment(args.taskId);

    if (args.actorId) {
      await requireAgencyAction(args.actorId, "task.assign");
    }

    // Same eligibility rule the direct assign path enforces, so a proposal can
    // never place someone the approval step would then be unable to honour.
    const assignee = await db.user.findUnique({
      where: { id: args.assigneeId },
      select: {
        name: true,
        isSuperAdmin: true,
        deactivatedAt: true,
        memberships: {
          where: { removedAt: null, acceptedAt: { not: null } },
          select: { role: true, teamId: true },
        },
      },
    });
    if (!assignee) throw new TRPCError({ code: "BAD_REQUEST", message: "That user does not exist." });
    if (assignee.deactivatedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That account is deactivated." });
    }
    const eligibility = checkAssignmentEligibility({
      memberships: assignee.memberships,
      isSuperAdmin: assignee.isSuperAdmin,
      projectTeamId: task.project.agencyTeamId,
    });
    if (!eligibility.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: eligibility.reason });
    }

    const autoApprove = args.actorId
      ? await canDecideForBranch(args.actorId, task.project.agencyTeamId)
      : false;

    const proposal = await db.$transaction(async (tx) => {
      // An undecided proposal is superseded, not deleted — what was suggested
      // and replaced is part of the record.
      await tx.taskAssignment.updateMany({
        where: { taskId: args.taskId, status: "proposed" },
        data: { status: "superseded", decidedAt: new Date(), decidedById: args.actorId },
      });

      const created = await tx.taskAssignment.create({
        data: {
          taskId: args.taskId,
          assigneeId: args.assigneeId,
          proposedById: args.actorId,
          rationale: args.rationale,
          ...(autoApprove
            ? { status: "approved" as const, decidedById: args.actorId, decidedAt: new Date() }
            : {}),
        },
      });

      if (autoApprove) {
        await tx.task.update({
          where: { id: args.taskId },
          data: { assigneeUserId: args.assigneeId },
        });
      }

      return created;
    });

    await AuditService.log({
      actorId: args.actorId,
      action: autoApprove ? "assignment.proposedAndApproved" : "assignment.proposed",
      entityType: "TaskAssignment",
      entityId: proposal.id,
      after: { taskId: args.taskId, assigneeId: args.assigneeId, autoApproved: autoApprove },
    });

    if (autoApprove) {
      await AssignmentService.notifyApproved(proposal.id, args.assigneeId, task.code, task.title);
    } else {
      await AssignmentService.notifyProposed(
        proposal.id,
        task.project.agencyTeamId,
        task.code,
        task.title,
        assignee.name,
        args.actorId,
      );
    }

    return proposal;
  }

  /** Approve a proposal. This is the moment the task is actually assigned. */
  static async approve(args: { actorId: string; assignmentId: string; note?: string }) {
    const proposal = await db.taskAssignment.findUnique({
      where: { id: args.assignmentId },
      include: {
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            project: { select: { agencyTeamId: true } },
          },
        },
      },
    });
    if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
    if (proposal.status !== "proposed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `That assignment is already ${proposal.status}.`,
      });
    }

    if (!(await canDecideForBranch(args.actorId, proposal.task.project.agencyTeamId))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the branch head, an Agency Admin or the COO can approve assignments on this branch.",
      });
    }

    const approved = await db.$transaction(async (tx) => {
      const updated = await tx.taskAssignment.update({
        where: { id: args.assignmentId },
        data: {
          status: "approved",
          decidedById: args.actorId,
          decidedAt: new Date(),
          decisionNote: args.note?.trim() || null,
        },
      });
      await tx.task.update({
        where: { id: proposal.taskId },
        data: { assigneeUserId: proposal.assigneeId },
      });

      // The contributor row is not bookkeeping — /team/assignments and
      // /team/reviews render `task.contributors` and print "Unassigned" when it
      // is empty. Setting assigneeUserId alone leaves a task that the detail
      // page shows as assigned and the branch's own queues show as nobody's.
      //
      // TaskService.assign (the direct path) has always kept these in step.
      // This path did not, so the two ways of assigning the same task produced
      // different state.
      await tx.taskContributor.updateMany({
        where: { taskId: proposal.taskId, removedAt: null },
        data: { isPrimary: false },
      });
      await tx.taskContributor.upsert({
        where: {
          taskId_userId_contributionRole: {
            taskId: proposal.taskId,
            userId: proposal.assigneeId,
            contributionRole: "Primary contributor",
          },
        },
        update: { isPrimary: true, removedAt: null },
        create: {
          taskId: proposal.taskId,
          userId: proposal.assigneeId,
          contributionRole: "Primary contributor",
          isPrimary: true,
        },
      });
      return updated;
    });

    await AuditService.log({
      actorId: args.actorId,
      action: "assignment.approved",
      entityType: "TaskAssignment",
      entityId: approved.id,
      before: { status: "proposed" },
      after: { status: "approved", assigneeId: proposal.assigneeId, taskId: proposal.taskId },
    });

    await AssignmentService.notifyApproved(
      approved.id,
      proposal.assigneeId,
      proposal.task.code,
      proposal.task.title,
    );

    return approved;
  }

  /** Reject a proposal. The task stays unassigned and the reason is kept. */
  static async reject(args: { actorId: string; assignmentId: string; note: string }) {
    const proposal = await db.taskAssignment.findUnique({
      where: { id: args.assignmentId },
      include: {
        task: { select: { code: true, title: true, project: { select: { agencyTeamId: true } } } },
      },
    });
    if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
    if (proposal.status !== "proposed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `That assignment is already ${proposal.status}.`,
      });
    }
    if (!args.note.trim()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Say why, so whoever proposed it knows what to do differently.",
      });
    }
    if (!(await canDecideForBranch(args.actorId, proposal.task.project.agencyTeamId))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the branch head, an Agency Admin or the COO can decide assignments on this branch.",
      });
    }

    const rejected = await db.taskAssignment.update({
      where: { id: args.assignmentId },
      data: {
        status: "rejected",
        decidedById: args.actorId,
        decidedAt: new Date(),
        decisionNote: args.note.trim(),
      },
    });

    await AuditService.log({
      actorId: args.actorId,
      action: "assignment.rejected",
      entityType: "TaskAssignment",
      entityId: rejected.id,
      before: { status: "proposed" },
      after: { status: "rejected", note: args.note.trim() },
    });

    if (rejected.proposedById) {
      await NotificationService.create({
        userId: rejected.proposedById,
        kind: "assignment_rejected",
        title: `Assignment declined — ${proposal.task.code}`,
        body: `${proposal.task.title}: ${args.note.trim()}`,
        link: `/tasks/${rejected.taskId}`,
        entityType: "TaskAssignment",
        entityId: rejected.id,
        allowDuplicate: true,
      });
    }

    return rejected;
  }


  /**
   * Propose the best available person for a task, using capability and load.
   *
   * Returns null rather than guessing when nobody is recorded as able to
   * deliver the service. A proposal drawn from no capability data is worse than
   * none: it looks considered, so a branch head is likely to wave it through.
   * The absence is itself the signal — the task waits for a manual proposal,
   * and the gap shows up on the service's capability panel.
   */
  static async autoPropose(taskId: string) {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        serviceId: true,
        assigneeUserId: true,
        project: { select: { agencyTeamId: true } },
        service: { select: { name: true } },
      },
    });
    if (!task || !task.serviceId) return null;

    // Never override a decision already made, and never stack a second
    // proposal on top of one still awaiting an answer.
    if (task.assigneeUserId) return null;
    const existing = await db.taskAssignment.findFirst({
      where: { taskId, status: "proposed" },
      select: { id: true },
    });
    if (existing) return null;

    const capabilities = await db.serviceCapability.findMany({
      where: { serviceId: task.serviceId, revokedAt: null },
      select: {
        level: true,
        user: {
          select: {
            id: true,
            name: true,
            isSuperAdmin: true,
            deactivatedAt: true,
            memberships: {
              where: { removedAt: null, acceptedAt: { not: null } },
              select: { role: true, teamId: true },
            },
          },
        },
      },
    });

    // Only people the approval step could actually honour — the same rule the
    // manual path enforces, so auto-proposal cannot produce something a branch
    // head is then unable to approve.
    const eligible = capabilities.filter(
      (entry) =>
        !entry.user.deactivatedAt &&
        checkAssignmentEligibility({
          memberships: entry.user.memberships,
          isSuperAdmin: entry.user.isSuperAdmin,
          projectTeamId: task.project.agencyTeamId,
        }).ok,
    );
    if (eligible.length === 0) return null;

    const loads = await db.task.groupBy({
      by: ["assigneeUserId"],
      where: {
        assigneeUserId: { in: eligible.map((entry) => entry.user.id) },
        status: { in: ["todo", "in_progress", "in_review"] },
      },
      _count: { _all: true },
      _sum: { estimatedHours: true },
    });
    const loadByUser = new Map(
      loads.map((row) => [
        row.assigneeUserId,
        {
          openTaskCount: row._count._all,
          estimatedHoursRemaining: Number(row._sum.estimatedHours ?? 0),
        },
      ]),
    );

    const ranked = rankCandidates(
      eligible.map((entry) => ({
        userId: entry.user.id,
        name: entry.user.name,
        level: entry.level,
        openTaskCount: loadByUser.get(entry.user.id)?.openTaskCount ?? 0,
        estimatedHoursRemaining: loadByUser.get(entry.user.id)?.estimatedHoursRemaining ?? 0,
      })),
    );

    const rationale = buildRationale(ranked, task.service?.name ?? null);

    // actorId null: the system proposed this, so it is never auto-approved.
    // A machine suggestion is exactly the case the branch head should see.
    return AssignmentService.propose({
      actorId: null,
      taskId,
      assigneeId: ranked[0]!.userId,
      rationale: rationale ?? undefined,
    });
  }

  private static async notifyProposed(
    assignmentId: string,
    branchId: string | null,
    taskCode: string,
    taskTitle: string,
    assigneeName: string,
    actorId: string | null,
  ) {
    // The branch head decides, so they are who needs telling. Falling back to
    // everyone who can approve keeps a proposal from stalling when a branch has
    // no lead assigned.
    const branch = branchId
      ? await db.team.findUnique({ where: { id: branchId }, select: { leadId: true } })
      : null;

    let recipients: string[] = branch?.leadId ? [branch.leadId] : [];
    if (recipients.length === 0) {
      const approvers = await db.membership.findMany({
        where: {
          role: { in: ["agency_admin", "chief_operating_officer"] },
          removedAt: null,
          acceptedAt: { not: null },
        },
        select: { userId: true },
      });
      recipients = approvers.map((m) => m.userId);
    }
    recipients = recipients.filter((id) => id !== actorId);
    if (recipients.length === 0) return;

    await NotificationService.createMany(recipients, {
      kind: "assignment_proposed",
      title: `Assignment needs your approval — ${taskCode}`,
      body: `${assigneeName} is proposed for "${taskTitle}".`,
      link: "/team/assignments",
      entityType: "TaskAssignment",
      entityId: assignmentId,
      allowDuplicate: true,
    });
  }

  private static async notifyApproved(
    assignmentId: string,
    assigneeId: string,
    taskCode: string,
    taskTitle: string,
  ) {
    await NotificationService.create({
      userId: assigneeId,
      kind: "assignment_approved",
      title: `Assigned to you — ${taskCode}`,
      body: taskTitle,
      link: "/tasks",
      entityType: "TaskAssignment",
      entityId: assignmentId,
      allowDuplicate: true,
    });
  }
}
