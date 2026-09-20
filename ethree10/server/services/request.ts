import { TRPCError } from "@trpc/server";
import { ALLOWED_TRANSITIONS, APPROVABLE_FROM } from "@/lib/request-stages";
import { Prisma, type RequestStage, type Urgency } from "@prisma/client";
import { db } from "@/server/db/client";
import { AuditService } from "@/server/services/audit";
import { NotificationService } from "@/server/services/notification";
import { EmailService } from "@/server/notifications/email";
import { ProjectService } from "@/server/services/project";
import { ApprovalService } from "@/server/services/approval";
import { generateCode, generatePublicToken, parseCode } from "@/lib/utils/codes";

/**
 * How long a client tracking link stays valid.
 *
 * Was 365 days, written out at four separate call sites. A capability URL good
 * for a year outlives the engagement, the email thread it was sent in, and
 * sometimes the client contact's employment — and the link is the whole
 * credential, so anyone who ever had it keeps that access.
 *
 * 90 days is safe to shorten to because `rotatePublicToken` already exists and
 * emails the client their new link, so an expiry is a reissue rather than a
 * dead end. Existing links keep the expiry they were issued with; this only
 * affects tokens minted from here on.
 */
const PUBLIC_TOKEN_DAYS = 90;
const publicTokenExpiry = () => new Date(Date.now() + PUBLIC_TOKEN_DAYS * 24 * 60 * 60 * 1000);


// The transition table moved to lib/request-stages.ts so the screen can use
// the same one. It was duplicated by hand in the request detail page, which
// is how the triage panel came to offer actions the server refuses.
export { ALLOWED_TRANSITIONS } from "@/lib/request-stages";

export interface CreateRequestInput {
  title: string;
  description: string;
  projectType: string;
  urgency: Urgency;
  deadline?: Date;
  primaryContact?: string;
  budgetEstimate?: number;
  currency?: string;
  serviceId?: string;
  expectedOutcome?: string;
  expectedDeliverables?: string;
  acceptanceCriteria?: string;
  supportingLinks?: string[];
  consentToEmail?: boolean;
}

async function nextRequestSeq(): Promise<number> {
  const year = new Date().getUTCFullYear();
  const latest = await db.request.findFirst({
    where: { code: { startsWith: `REQ-${year}-` } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  return (latest ? parseCode(latest.code)?.seq ?? 0 : 0) + 1;
}

// Agency admins = staff (org-null) memberships with the admin role.
async function agencyLeadUserIds(): Promise<string[]> {
  const leads = await db.membership.findMany({
    where: {

      role: { in: ["agency_admin"] },
      removedAt: null,
      acceptedAt: { not: null },
    },
    select: { userId: true },
  });
  return leads.map((m) => m.userId);
}

/**
 * Best-effort email to the (no-login) client behind a link-tracked request.
 * No-ops unless the request carries a requester email + tracking token; every
 * message deep-links back to the public tracking page.
 */
async function emailClient(
  request: { code: string; requesterEmail: string | null; publicToken: string | null; consentToEmail: boolean },
  args: { title: string; body?: string },
): Promise<void> {
  if (!request.requesterEmail || !request.publicToken || !request.consentToEmail) return;
  await EmailService.sendNotification({
    to: request.requesterEmail,
    title: args.title,
    body: args.body,
    ctaLabel: "Track your request",
    ctaPath: `/track/${request.publicToken}`,
  });
}

function orgSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * A public (no-login) client is represented by a lightweight external Organization.
 * Reuse an existing external org with the same name; otherwise create one with a
 * unique slug. This keeps "all requests from this client" grouping intact.
 */
export async function findOrCreateClientOrg(args: { name: string; requesterEmail: string }) {
  const name = args.name.trim() || "Client";
  const emailDomain = args.requesterEmail.trim().toLowerCase().split("@")[1];
  const existing = await db.organization.findFirst({
    where: {
      isExternal: true,
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      requests: emailDomain
        ? { some: { requesterEmail: { endsWith: `@${emailDomain}`, mode: "insensitive" } } }
        : undefined,
    },
  });
  if (existing) return existing;

  const root = orgSlugify(name) || "client";
  let slug = root;
  let n = 1;
  while (await db.organization.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${root}-${n++}`;
  }
  return db.organization.create({
    data: { name, slug, isExternal: true },
  });
}

/**
 * Resolve the agency team a request should route to, based on its task type.
 * Returns null when the type isn't in the catalog or the matching team doesn't exist
 * (e.g. legacy free-text types) — the request then stays unrouted for manual triage.
 */
async function resolveService(serviceId?: string) {
  if (!serviceId) return null;
  const service = await db.service.findFirst({
    where: { id: serviceId, isActive: true },
    select: { id: true, slug: true, teamId: true, requiredBriefFields: true, defaultUrgency: true },
  });
  if (!service) throw new TRPCError({ code: "BAD_REQUEST", message: "Selected service is unavailable." });
  return service;
}

function validateRequiredBrief(service: { requiredBriefFields: Prisma.JsonValue }, input: CreateRequestInput) {
  const required = Array.isArray(service.requiredBriefFields)
    ? service.requiredBriefFields.filter((value): value is string => typeof value === "string")
    : [];
  const values: Record<string, unknown> = {
    expectedOutcome: input.expectedOutcome,
    expectedDeliverables: input.expectedDeliverables,
    acceptanceCriteria: input.acceptanceCriteria,
    deadline: input.deadline,
    supportingLinks: input.supportingLinks,
    budgetEstimate: input.budgetEstimate,
  };
  const missing = required.filter((field) => {
    const value = values[field];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
  if (missing.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Missing required brief fields: ${missing.join(", ")}` });
  }
}

async function notifyIntakeOwners(request: { id: string; code: string; title: string; routedTeamId: string | null }) {
  const memberships = await db.membership.findMany({
    where: request.routedTeamId
      ? { role: "branch_head", teamId: request.routedTeamId, removedAt: null, acceptedAt: { not: null } }
      : { role: "agency_admin", removedAt: null, acceptedAt: { not: null } },
    select: { userId: true },
  });
  await NotificationService.createMany(Array.from(new Set(memberships.map((m) => m.userId))), {
    kind: "request_submitted",
    title: request.routedTeamId ? `New routed request: ${request.title}` : `Unclassified request: ${request.title}`,
    body: request.code,
    link: `/requests/${request.id}`,
    entityType: "Request",
    entityId: request.id,
  });
}

export class RequestService {
  static requestInclude = {
    routedTeam: { select: { id: true, name: true, slug: true } },
    service: { select: { id: true, name: true, slug: true, expectedDeliverables: true, requiredReviews: true } },
    organization: { select: { id: true, name: true, isExternal: true, slug: true } },
    // _count.tasks, because the screen needs to say "no tasks yet, so nobody
    // can be assigned" — the single most common reason work stalls here.
    project: { select: { id: true, code: true, status: true, _count: { select: { tasks: true } } } },
    stageEvents: {
      orderBy: { createdAt: "asc" } as const,
    },
  } satisfies Prisma.RequestInclude;

  static async getById(id: string) {
    const request = await db.request.findUnique({
      where: { id },
      include: {
        ...RequestService.requestInclude,
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        },
        attachments: true,
      },
    });
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
    const submitter = request.submittedById
      ? await db.user.findUnique({
          where: { id: request.submittedById },
          select: { id: true, name: true, avatarUrl: true },
        })
      : null;
    return { ...request, submitter };
  }

  static async listForWorkspace(
    organizationId: string,
    filters: { stage?: RequestStage; routedTeamId?: string; limit?: number } = {},
  ) {
    return db.request.findMany({
      where: {
        organizationId,
        stage: filters.stage,
        routedTeamId: filters.routedTeamId,
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
      include: RequestService.requestInclude,
    });
  }

  /** Agency-wide triage queue: requests across all client organizations. */
  static async inbox(filters: { stage?: RequestStage; routedTeamId?: string } = {}) {
    return db.request.findMany({
      where: {
        stage: filters.stage ?? { in: ["submitted", "needs_clarification", "under_review", "scoping"] },
        routedTeamId: filters.routedTeamId,
      },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      take: 200,
      include: RequestService.requestInclude,
    });
  }

  static async listSubmittedBy(userId: string) {
    return db.request.findMany({
      where: { submittedById: userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: RequestService.requestInclude,
    });
  }

  static async create(args: {
    actorId: string;
    organizationId: string;
    input: CreateRequestInput;
  }) {
    const seq = await nextRequestSeq();
    const code = generateCode("request", seq);

    // Self-routing: derive the target team from the chosen task type so the request
    // lands with the right team (Creative vs Product Development) without manual triage.
    const service = await resolveService(args.input.serviceId);
    if (service) validateRequiredBrief(service, args.input);
    const routedTeamId = service?.teamId ?? null;

    const created = await db.request.create({
      data: {
        code,
        // Internally-raised requests get a tracking link too. A staff member
        // logging a request on a client's behalf still needs something to send
        // them — without this, "Copy tracking link" had nothing to copy.
        publicToken: generatePublicToken(),
        publicTokenExpiresAt: publicTokenExpiry(),
        organizationId: args.organizationId,
        submittedById: args.actorId,
        title: args.input.title,
        description: args.input.description,
        projectType: args.input.projectType,
        serviceId: service?.id,
        expectedOutcome: args.input.expectedOutcome,
        expectedDeliverables: args.input.expectedDeliverables,
        acceptanceCriteria: args.input.acceptanceCriteria,
        supportingLinks: args.input.supportingLinks ?? [],
        consentToEmail: args.input.consentToEmail ?? false,
        routedTeamId,
        urgency: args.input.urgency,
        deadline: args.input.deadline ?? null,
        primaryContact: args.input.primaryContact ?? null,
        budgetEstimate:
          args.input.budgetEstimate !== undefined
            ? new Prisma.Decimal(args.input.budgetEstimate)
            : null,
        currency: args.input.currency ?? "NGN",
        stage: "submitted",
      },
    });
    await db.requestStageEvent.create({
      data: { requestId: created.id, toStage: "submitted", actorId: args.actorId },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: args.organizationId,
      action: "request.create",
      entityType: "Request",
      entityId: created.id,
      after: { stage: created.stage, code: created.code },
    });
    await NotificationService.createMany(await agencyLeadUserIds(), {
      kind: "request_submitted",
      title: `New request: ${created.title}`,
      body: created.code,
      link: `/requests/${created.id}`,
      entityType: "Request",
      entityId: created.id,
    });
    await notifyIntakeOwners(created);
    return created;
  }

  /**
   * Public (no-login) submission from the marketing site. Creates a real Request under
   * a lightweight external client Organization, stamps a secret publicToken for the
   * tracking link, auto-routes by task type, and notifies agency leads. No staff actor.
   */
  static async createPublic(args: {
    requesterName: string;
    requesterEmail: string;
    requesterPhone?: string;
    organizationName?: string;
    input: CreateRequestInput;
  }) {
    const organization = await findOrCreateClientOrg({
      name: args.organizationName?.trim() || args.requesterName,
      requesterEmail: args.requesterEmail,
    });
    const seq = await nextRequestSeq();
    const code = generateCode("request", seq);
    const publicToken = generatePublicToken();
    // Public submissions are intentionally unclassified. The client tells us what
    // they need in plain words; a human picks the service, branch and urgency
    // during triage. A request with no service simply arrives unrouted in the
    // Intake Queue, which is the correct place for a decision to be made.
    const service = await resolveService(args.input.serviceId);
    const routedTeamId = service?.teamId ?? null;

    const created = await db.request.create({
      data: {
        code,
        publicToken,
        publicTokenExpiresAt: publicTokenExpiry(),
        organizationId: organization.id,
        submittedById: null,
        requesterName: args.requesterName,
        requesterEmail: args.requesterEmail,
        requesterPhone: args.requesterPhone ?? null,
        title: args.input.title,
        description: args.input.description,
        projectType: args.input.projectType,
        serviceId: service?.id ?? null,
        expectedOutcome: args.input.expectedOutcome,
        expectedDeliverables: args.input.expectedDeliverables,
        acceptanceCriteria: args.input.acceptanceCriteria,
        supportingLinks: args.input.supportingLinks ?? [],
        consentToEmail: args.input.consentToEmail ?? false,
        routedTeamId,
        urgency: args.input.urgency,
        deadline: args.input.deadline ?? null,
        primaryContact: args.input.primaryContact ?? args.requesterName,
        budgetEstimate:
          args.input.budgetEstimate !== undefined
            ? new Prisma.Decimal(args.input.budgetEstimate)
            : null,
        currency: args.input.currency ?? "NGN",
        stage: "submitted",
      },
    });

    await db.requestStageEvent.create({
      data: { requestId: created.id, toStage: "submitted", actorId: null },
    });
    await AuditService.log({
      actorId: null,
      organizationId: organization.id,
      action: "request.public_create",
      entityType: "Request",
      entityId: created.id,
      after: { stage: created.stage, code: created.code, requesterEmail: args.requesterEmail },
    });
    await NotificationService.createMany(await agencyLeadUserIds(), {
      kind: "request_submitted",
      title: `New request: ${created.title}`,
      body: `${created.code} · from ${args.requesterName}`,
      link: `/requests/${created.id}`,
      entityType: "Request",
      entityId: created.id,
    });
    await notifyIntakeOwners(created);
    await emailClient(created, {
      title: `We received your request (${created.code})`,
      body: `Thanks, ${args.requesterName} — "${created.title}" is with our team for review. Use the link below any time to check progress or message us; no account needed.`,
    });

    return { id: created.id, code: created.code, publicToken };
  }

  static async rotatePublicToken(args: { actorId: string; requestId: string }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    const publicToken = generatePublicToken();
    const updated = await db.request.update({
      where: { id: args.requestId },
      data: {
        publicToken,
        publicTokenRevokedAt: null,
        publicTokenExpiresAt: publicTokenExpiry(),
      },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.tracking_token_rotated",
      entityType: "Request",
      entityId: before.id,
    });
    await emailClient(updated, {
      title: `Your secure tracking link was updated (${updated.code})`,
      body: "For security, the previous link has been replaced. Use this new link going forward.",
    });
    return updated;
  }

  static async revokePublicToken(args: { actorId: string; requestId: string }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    const updated = await db.request.update({
      where: { id: args.requestId },
      data: { publicTokenRevokedAt: new Date() },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.tracking_token_revoked",
      entityType: "Request",
      entityId: before.id,
    });
    return updated;
  }

  static async route(args: {
    actorId: string;
    requestId: string;
    teamId: string;
    note?: string;
  }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });

    const team = await db.team.findUnique({
      where: { id: args.teamId },
      select: { id: true, name: true, leadId: true },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const advanceToReview = before.stage === "submitted";
    let targetStage = advanceToReview ? "under_review" : before.stage;

    if (advanceToReview) {
      const organization = await db.organization.findUnique({ where: { id: before.organizationId } });
      if (organization) {
        const rule = await ApprovalService.checkRules(before, organization);
        if (rule) {
          targetStage = "pending_approval";
          await ApprovalService.notifyApprovers(rule, before);
        }
      }
    }

    const updated = await db.request.update({
      where: { id: args.requestId },
      data: {
        routedTeamId: args.teamId,
        stage: targetStage,
      },
    });
    if (targetStage !== before.stage) {
      await db.requestStageEvent.create({
        data: {
          requestId: args.requestId,
          fromStage: before.stage,
          toStage: targetStage,
          actorId: args.actorId,
          note: args.note ?? null,
        },
      });
    }
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.route",
      entityType: "Request",
      entityId: args.requestId,
      before: { routedTeamId: before.routedTeamId },
      after: { routedTeamId: args.teamId },
    });
    if (team.leadId) {
      await NotificationService.create({
        userId: team.leadId,
        kind: "request_assigned",
        title: `Request routed to ${team.name}`,
        body: `${updated.code}: ${updated.title}`,
        link: `/requests/${updated.id}`,
        entityType: "Request",
        entityId: updated.id,
      });
    }
    return updated;
  }

  static async transition(args: {
    actorId: string;
    requestId: string;
    toStage: RequestStage;
    note?: string;
  }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });

    const allowed = ALLOWED_TRANSITIONS[before.stage] ?? [];
    if (!allowed.includes(args.toStage)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Illegal transition: ${before.stage} → ${args.toStage}`,
      });
    }

    const updated = await db.request.update({
      where: { id: args.requestId },
      data: { stage: args.toStage },
    });
    await db.requestStageEvent.create({
      data: {
        requestId: args.requestId,
        fromStage: before.stage,
        toStage: args.toStage,
        actorId: args.actorId,
        note: args.note ?? null,
      },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.transition",
      entityType: "Request",
      entityId: args.requestId,
      before: { stage: before.stage },
      after: { stage: args.toStage },
    });
    if (before.submittedById) {
      await NotificationService.create({
        userId: before.submittedById,
        kind: "request_state_changed",
        title: `Your request is now ${args.toStage.replace(/_/g, " ")}`,
        body: `${updated.code}: ${updated.title}`,
        link: `/requests/${updated.id}`,
        entityType: "Request",
        entityId: updated.id,
      });
    }
    await emailClient(updated, {
      title: `Your request is now ${args.toStage.replace(/_/g, " ")} (${updated.code})`,
      body: `"${updated.title}" moved to ${args.toStage.replace(/_/g, " ")}.${args.note ? ` Note from the team: ${args.note}` : ""}`,
    });

    if (args.toStage === "approved") {
      await ProjectService.createFromRequest({ actorId: args.actorId, requestId: args.requestId });
    }
    return updated;
  }

  static async approve(args: { actorId: string; requestId: string }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    if (!APPROVABLE_FROM.includes(before.stage)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Request cannot be accepted from ${before.stage}.` });
    }
    const updated = await db.request.update({
      where: { id: args.requestId },
      data: { stage: "approved", approvedById: args.actorId },
    });
    await db.requestStageEvent.create({
      data: {
        requestId: args.requestId,
        fromStage: before.stage,
        toStage: "approved",
        actorId: args.actorId,
      },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.approve",
      entityType: "Request",
      entityId: args.requestId,
      before: { stage: before.stage },
      after: { stage: "approved" },
    });
    await ProjectService.createFromRequest({ actorId: args.actorId, requestId: args.requestId });
    if (before.submittedById) {
      await NotificationService.create({
        userId: before.submittedById,
        kind: "request_state_changed",
        title: "Your request was approved",
        body: `${updated.code}: ${updated.title}`,
        link: `/requests/${updated.id}`,
        entityType: "Request",
        entityId: updated.id,
      });
    }
    await emailClient(updated, {
      title: `Your request was approved (${updated.code})`,
      body: `Great news — "${updated.title}" was approved and is moving into delivery.`,
    });
    return updated;
  }

  static async reject(args: { actorId: string; requestId: string; reason: string }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    if (["approved", "in_progress", "in_review", "delivered", "closed", "cancelled", "rejected"].includes(before.stage)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Request cannot be rejected from ${before.stage}.` });
    }
    const updated = await db.request.update({
      where: { id: args.requestId },
      data: { stage: "rejected", rejectedReason: args.reason },
    });
    await db.requestStageEvent.create({
      data: {
        requestId: args.requestId,
        fromStage: before.stage,
        toStage: "rejected",
        actorId: args.actorId,
        note: args.reason,
      },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.reject",
      entityType: "Request",
      entityId: args.requestId,
      before: { stage: before.stage },
      after: { stage: "rejected", reason: args.reason },
    });
    if (before.submittedById) {
      await NotificationService.create({
        userId: before.submittedById,
        kind: "request_state_changed",
        title: "Your request was not accepted",
        body: args.reason,
        link: `/requests/${updated.id}`,
        entityType: "Request",
        entityId: updated.id,
      });
    }
    await emailClient(updated, {
      title: `Update on your request (${updated.code})`,
      body: `We couldn't take "${updated.title}" forward this time. Reason: ${args.reason}. Reply on your tracking page if you'd like to discuss.`,
    });
    return updated;
  }

  static async update(args: {
    actorId: string;
    requestId: string;
    patch: Partial<Pick<CreateRequestInput, "title" | "description" | "urgency" | "deadline">>;
  }) {
    const before = await db.request.findUnique({ where: { id: args.requestId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    const updated = await db.request.update({
      where: { id: args.requestId },
      data: {
        title: args.patch.title,
        description: args.patch.description,
        urgency: args.patch.urgency,
        deadline: args.patch.deadline,
      },
    });
    await AuditService.log({
      actorId: args.actorId,
      organizationId: before.organizationId,
      action: "request.update",
      entityType: "Request",
      entityId: args.requestId,
      before: { title: before.title, urgency: before.urgency },
      after: { title: updated.title, urgency: updated.urgency },
    });
    return updated;
  }

  static async addComment(args: {
    actorId: string;
    requestId: string;
    body: string;
    isInternal: boolean;
    mentions?: string[];
  }) {
    const comment = await db.taskComment.create({
      data: {
        requestId: args.requestId,
        authorId: args.actorId,
        body: args.body,
        isInternal: args.isInternal,
        mentions: args.mentions ?? [],
      },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    if (args.mentions?.length) {
      await NotificationService.createMany(args.mentions, {
        kind: "mention",
        title: "You were mentioned on a request",
        link: `/requests/${args.requestId}`,
        entityType: "Request",
        entityId: args.requestId,
      });
    }
    // Client-visible staff replies land in the client's inbox with the tracking link.
    if (!args.isInternal) {
      const request = await db.request.findUnique({
        where: { id: args.requestId },
        select: { code: true, title: true, requesterEmail: true, publicToken: true, consentToEmail: true },
      });
      if (request) {
        await emailClient(request, {
          title: `New reply on your request (${request.code})`,
          body: `${comment.author?.name ?? "The team"} replied on "${request.title}":\n\n${args.body.slice(0, 500)}`,
        });
      }
    }
    return comment;
  }
}
