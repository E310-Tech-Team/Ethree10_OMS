import { z } from "zod";
import { hasAgencyWideScope } from "@/server/auth/role-groups";
import { TRPCError } from "@trpc/server";
import { RequestStage, Urgency } from "@prisma/client";
import { router, publicProcedure } from "../trpc";
import { protectedProcedure } from "../procedures";
import { db } from "@/server/db/client";
import { visibleTeamIds } from "@/server/auth/visibility";
import { can } from "@/server/auth/permissions";
import { enforcePublicRateLimit } from "@/server/security/public-rate-limit";
import { RequestService } from "@/server/services/request";
import { posthogServer } from "@/lib/posthog";
import {
  getAgencyAuthContext,
  requireAgencyAction,
} from "@/server/services/agency";

const createInput = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  projectType: z.string().min(2),
  urgency: z.nativeEnum(Urgency).default("medium"),
  deadline: z.date().optional(),
  primaryContact: z.string().optional(),
  budgetEstimate: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  serviceId: z.string().optional(),
  expectedOutcome: z.string().trim().min(10).optional(),
  expectedDeliverables: z.string().trim().min(3).optional(),
  acceptanceCriteria: z.string().trim().min(3).optional(),
  supportingLinks: z.array(z.string().url()).max(10).optional(),
  consentToEmail: z.boolean().default(false),
});

/**
 * A request is readable by agency staff (any request) or by members of the
 * request's own organization (their own org's requests). Returns the loaded
 * request so callers can avoid a second fetch.
 */
async function assertCanReadRequest(userId: string, requestId: string) {
  const request = await db.request.findUnique({ where: { id: requestId } });
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });

  const agencyCtx = await getAgencyAuthContext(userId);
  if (can(agencyCtx, "request.read")) {
    if (hasAgencyWideScope(agencyCtx)) {
      return request;
    }
    if (request.routedTeamId) {
      const membership = await db.membership.findFirst({
        where: { userId, teamId: request.routedTeamId, removedAt: null, acceptedAt: { not: null } }
      });
      if (membership) return request;
    }
  }

  if (request.submittedById === userId) return request;

  throw new TRPCError({ code: "FORBIDDEN" });
}

export const requestsRouter = router({
  // Public marketing-site intake → creates a real Request under a lightweight
  // external client org and returns the tracking token (no login required).
  publicSubmit: publicProcedure
    .input(
      z.object({
        // Deliberately minimal. The requester describes what they need; staff
        // classify the service, set urgency, and agree scope during triage.
        // Phone is the only optional field.
        requesterName: z.string().min(2),
        requesterEmail: z.string().email(),
        requesterPhone: z.string().optional(),
        organizationName: z.string().trim().min(2),
        title: z.string().min(3),
        description: z.string().min(10),
        deadline: z.coerce.date(),
        // Optional: plenty of real requesters have no budget in mind and no
        // links to hand. Requiring them only turns away genuine work.
        budgetEstimate: z.number().nonnegative().optional(),
        expectedDeliverables: z.string().trim().min(3),
        supportingLinks: z.array(z.string().url()).max(10).default([]),
        consentToEmail: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The only unauthenticated write endpoint in the system: it creates a
      // Request, may create an Organization, and notifies staff. Spec §19.9
      // requires it to be throttled. Limited on two axes so neither a single
      // network nor a single address can flood intake.
      const forwardedFor = ctx.headers.get("x-forwarded-for") ?? "";
      const clientIp = forwardedFor.split(",")[0]?.trim() || ctx.headers.get("x-real-ip") || "unknown";
      await enforcePublicRateLimit({
        action: "request-submit-ip",
        secret: clientIp,
        limit: 5,
        windowSeconds: 600,
      });
      await enforcePublicRateLimit({
        action: "request-submit-email",
        secret: input.requesterEmail.toLowerCase(),
        limit: 3,
        windowSeconds: 3600,
      });

      const result = await RequestService.createPublic({
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        requesterPhone: input.requesterPhone,
        organizationName: input.organizationName,
        input: {
          title: input.title,
          description: input.description,
          // Unclassified until a human triages it. `projectType` stays empty and
          // no serviceId is set, so `resolveRoutedTeamId` leaves the request
          // unrouted and it lands in the Intake Queue.
          projectType: "",
          urgency: "medium",
          deadline: input.deadline,
          budgetEstimate: input.budgetEstimate,
          primaryContact: input.requesterName,
          expectedDeliverables: input.expectedDeliverables,
          supportingLinks: input.supportingLinks,
          consentToEmail: input.consentToEmail,
        },
      });
      return { code: result.code, publicToken: result.publicToken };
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string().optional(),
          stage: z.nativeEnum(RequestStage).optional(),
          routedTeamId: z.string().optional(),
          limit: z.number().min(1).max(100).default(50),
        })
    )
    .query(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "request.read");
      const teamIds = await visibleTeamIds(ctx.userId);
      return db.request.findMany({
        where: {
          organizationId: input.organizationId,
          stage: input.stage,
          routedTeamId: teamIds === null ? input.routedTeamId : { in: teamIds },
        },
        take: input.limit,
        orderBy: { createdAt: "desc" },
        // The list showed "Assigned"/"Unassigned" because it had no team name
        // to show. Naming the branch is what lets a reader tell whether a row
        // is theirs without opening it.
        include: {
          routedTeam: { select: { id: true, name: true } },
          organization: { select: { id: true, name: true } },
        },
      });
    }),

  myRequests: protectedProcedure.query(async ({ ctx }) => {
    return RequestService.listSubmittedBy(ctx.userId);
  }),

  inbox: protectedProcedure
    .input(
      z
        .object({
          stage: z.nativeEnum(RequestStage).optional(),
          routedTeamId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "request.read");
      const teamIds = await visibleTeamIds(ctx.userId);
      if (teamIds === null) return RequestService.inbox({ stage: input?.stage, routedTeamId: input?.routedTeamId });
      return db.request.findMany({
        where: {
          stage: input?.stage ?? { in: ["submitted", "needs_clarification", "under_review", "scoping"] },
          routedTeamId: { in: teamIds },
        },
        include: RequestService.requestInclude,
        orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      });
    }),

  /** Agency teams available as routing targets. */
  agencyTeams: protectedProcedure.query(async ({ ctx }) => {
    await requireAgencyAction(ctx.userId, "request.read");
    return db.team.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, color: true },
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      const request = await RequestService.getById(input.id);

      const agencyCtx = await getAgencyAuthContext(ctx.userId);
      if (!can(agencyCtx, "request.read")) {
        request.comments = request.comments.filter((c) => !c.isInternal);
      }
      
      return request;
    }),

  rotateTrackingLink: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.update");
      return RequestService.rotatePublicToken({ actorId: ctx.userId, requestId: input.id });
    }),

  revokeTrackingLink: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.update");
      return RequestService.revokePublicToken({ actorId: ctx.userId, requestId: input.id });
    }),

  create: protectedProcedure.input(createInput.extend({ organizationId: z.string() })).mutation(async ({ ctx, input }) => {
      await requireAgencyAction(ctx.userId, "request.create");
      const { organizationId, ...rest } = input;
      const request = await RequestService.create({
        actorId: ctx.userId,
        organizationId: organizationId,
        input: rest,
      });

      posthogServer.capture({
        distinctId: ctx.userId,
        event: "request_submitted",
        properties: { requestId: request.id, organizationId: organizationId },
      });

      return request;
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(3).optional(),
        description: z.string().min(10).optional(),
        urgency: z.nativeEnum(Urgency).optional(),
        deadline: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await assertCanReadRequest(ctx.userId, input.id);
      // Requester can edit their own draft; agency staff can always edit.
      const agencyCtx = await getAgencyAuthContext(ctx.userId);
      const isOwner = request.submittedById === ctx.userId;
      if (!isOwner && !can(agencyCtx, "request.update")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { id, ...patch } = input;
      return RequestService.update({ actorId: ctx.userId, requestId: id, patch });
    }),

  route: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.route");
      const result = await RequestService.route({
        actorId: ctx.userId,
        requestId: input.id,
        teamId: input.teamId,
        note: input.note,
      });

      posthogServer.capture({
        distinctId: ctx.userId,
        event: "request_routed",
        properties: { requestId: input.id, teamId: input.teamId },
      });

      return result;
    }),

  transition: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        toStage: z.nativeEnum(RequestStage),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.transition");
      return RequestService.transition({
        actorId: ctx.userId,
        requestId: input.id,
        toStage: input.toStage,
        note: input.note,
      });
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.approve");
      return RequestService.approve({ actorId: ctx.userId, requestId: input.id });
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.string(), reason: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      await assertCanReadRequest(ctx.userId, input.id);
      await requireAgencyAction(ctx.userId, "request.reject");
      return RequestService.reject({
        actorId: ctx.userId,
        requestId: input.id,
        reason: input.reason,
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const request = await assertCanReadRequest(ctx.userId, input.id);
      const isOwner = request.submittedById === ctx.userId;
      if (!isOwner) {
        await requireAgencyAction(ctx.userId, "request.transition");
      }
      return RequestService.transition({
        actorId: ctx.userId,
        requestId: input.id,
        toStage: "cancelled",
        note: input.reason,
      });
    }),

  comment: protectedProcedure
    .input(
      z.object({
        requestId: z.string(),
        body: z.string().min(1),
        isInternal: z.boolean().default(false),
        mentions: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await assertCanReadRequest(ctx.userId, input.requestId);
      // Staff need comment.create; the request's own submitter may always comment on it.
      // Non-agency callers who are not the submitter are blocked.
      if (request.submittedById !== ctx.userId) {
        const agencyCtx = await getAgencyAuthContext(ctx.userId);
        if (!can(agencyCtx, "comment.create")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Missing permission: comment.create" });
        }
      }
      return RequestService.addComment({
        actorId: ctx.userId,
        requestId: input.requestId,
        body: input.body,
        isInternal: input.isInternal,
        mentions: input.mentions,
      });
    }),
});
