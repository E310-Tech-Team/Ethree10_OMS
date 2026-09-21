import type { NotificationKind } from "@prisma/client";
import { db } from "@/server/db/client";
import { EmailService } from "@/server/notifications/email";
import { TwilioService } from "@/server/notifications/twilio";
import { sendPushToUser } from "@/server/notifications/push";

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

// Kinds that also send an email by default (task_due_soon is in-app only).
//
// Every kind added for the "notify on all activities" work emails by default.
// tests/unit/notification-coverage.test.ts asserts that, so a new kind cannot
// be added and silently default to in-app only. Anyone who finds a kind noisy
// can turn its email off per-kind in Settings; the in-app record remains.
export const EMAIL_KINDS = new Set<NotificationKind>([
  "request_submitted",
  "request_assigned",
  "request_state_changed",
  "task_assigned",
  "task_overdue",
  "task_completed",
  "mention",
  "proposal_sent",
  "proposal_accepted",
  "report_ready",
  "approval_requested",
  "integration_degraded",
  "csat_received",
  // Money
  "invoice_sent",
  "invoice_overdue",
  "payment_received",
  "receipt_issued",
  "expense_requested",
  "expense_paid",
  "budget_decided",
  // People
  "member_invited",
  "member_role_changed",
  "member_removed",
  // Agency structure
  "branch_created",
  "branch_archived",
  "branch_lead_assigned",
  "department_created",
  "department_archived",
  "department_lead_assigned",
  "client_created",
  "client_archived",
  // Delivery artefacts
  "deliverable_created",
  "deliverable_version_added",
  "contributors_changed",
  // Enquiries
  "lead_received",
  "lead_converted",
  // Assignment approval
  "assignment_proposed",
  "assignment_approved",
  "assignment_rejected",
]);

type DeliveryPreferences = {
  email: boolean;
  push: boolean;
  whatsapp: boolean;
};

type NotificationDeliveryUpdates = {
  emailedAt?: Date;
  pushedAt?: Date;
  whatsappAt?: Date;
};

export interface CreateNotificationArgs {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Suppress the hour-long dedup window for this notification.
   *
   * Dedup exists to stop repeated *state* notifications about the same entity
   * stacking up. It is wrong for events that carry new content each time —
   * a client posting two messages on one request within the hour is two things
   * to read, not a duplicate, and collapsing them silently dropped the second.
   */
  allowDuplicate?: boolean;
}

/**
 * In-app notification writes. Email/WhatsApp delivery is layered on in Sprint 5
 * by enqueuing a delivery job off the row created here.
 */
export class NotificationService {
  static async create(args: CreateNotificationArgs) {
    if (!args.allowDuplicate && args.entityId && args.entityType) {
      const recent = await db.notification.findFirst({
        where: {
          userId: args.userId,
          kind: args.kind,
          entityType: args.entityType,
          entityId: args.entityId,
          createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
        },
      });
      if (recent) return recent;
    }
    const notification = await db.notification.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        title: args.title,
        body: args.body ?? null,
        link: args.link ?? null,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
      },
    });

    const user = await db.user.findUnique({
      where: { id: args.userId },
      select: { email: true, phone: true, phoneVerifiedAt: true, deactivatedAt: true, timezone: true },
    });

    if (user && !user.deactivatedAt) {
      // Check preferences
      let prefs: DeliveryPreferences | null = await db.notificationPreference.findUnique({
        where: { userId_kind: { userId: args.userId, kind: args.kind } },
      });

      if (!prefs) {
        // Default preferences
        prefs = {
          email: EMAIL_KINDS.has(args.kind),
          push: true,
          whatsapp: false, // Default false until they verify
        };
      }

      const updates: NotificationDeliveryUpdates = {};

      if (prefs!.email && user.email) {
        const sent = await EmailService.sendNotification({
          to: user.email,
          title: args.title,
          body: args.body ?? undefined,
          ctaPath: args.link ?? undefined,
        });
        if (sent) updates.emailedAt = new Date();
      }

      if (prefs!.whatsapp && user.phone && user.phoneVerifiedAt) {
        // Quiet hours check (8am - 8pm in user timezone)
        // For simplicity, we just send it if we're not strict, or you could queue it.
        // Let's do a basic timezone hour check if possible, or just send.
        const d = new Date();
        const userTimeStr = d.toLocaleString("en-US", { timeZone: user.timezone || "Africa/Lagos" });
        const userHour = new Date(userTimeStr).getHours();
        
        if (userHour >= 8 && userHour <= 20) {
          const body = `*${args.title}*\n${args.body || ""}\n${args.link ? `Link: ${args.link}` : ""}`;
          const sent = await TwilioService.sendWhatsApp(user.phone, body);
          if (sent) updates.whatsappAt = new Date();
        } else {
          // Queued for later in a real system. Here we just drop or send anyway.
          console.log(`Quiet hours: Skipping WhatsApp for ${user.phone}`);
        }
      }

      if (prefs!.push) {
        // No device check: sendPushToUser is a no-op when the user has no live
        // subscription, and push is the one channel that needs no address —
        // the browser registered itself.
        const sent = await sendPushToUser(args.userId, {
          title: args.title,
          body: args.body ?? undefined,
          url: args.link ?? undefined,
          // Collapse repeats of the same thing on the same record instead of
          // stacking six identical banners.
          tag: args.entityId ? `${args.kind}:${args.entityId}` : args.kind,
        });
        if (sent) updates.pushedAt = new Date();
      }

      if (Object.keys(updates).length > 0) {
        await db.notification.update({
          where: { id: notification.id },
          data: updates,
        });
      }
    }
    return notification;
  }

  static async createMany(
    userIds: Array<string | null | undefined>,
    args: Omit<CreateNotificationArgs, "userId">,
  ) {
    const unique = Array.from(
      new Set(userIds.filter((id): id is string => Boolean(id))),
    );
    await Promise.all(unique.map((userId) => this.create({ ...args, userId })));
  }

  static async list(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    return db.notification.findMany({
      where: { userId, readAt: opts.unreadOnly ? null : undefined },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
  }

  static async unreadCount(userId: string) {
    return db.notification.count({ where: { userId, readAt: null } });
  }

  static async markRead(userId: string, ids: string[]) {
    await db.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { readAt: new Date() },
    });
  }

  static async markAllRead(userId: string) {
    await db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
