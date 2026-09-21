import { z } from "zod";
import { router } from "../trpc";
import { protectedProcedure } from "../procedures";
import { publicProcedure } from "../trpc";
import { db } from "@/server/db/client";
import { vapidPublicKey, pushEnabled } from "@/server/notifications/push";

/**
 * Managing this browser's push subscription.
 *
 * A subscription belongs to a browser, not to a person: signed in on a laptop
 * and a phone is two rows. The endpoint is the identity — it is the URL at the
 * browser vendor's push service that the server posts to — so it is unique, and
 * re-subscribing on the same browser updates rather than duplicates.
 *
 * The endpoint and its keys are effectively a capability to notify this device.
 * Every procedure here is scoped to the caller's own rows; none of them takes a
 * userId.
 */
export const pushRouter = router({
  /**
   * The VAPID public key the browser needs in order to subscribe, and whether
   * the server can send at all. Public by design — it is handed to every
   * client that subscribes — and public here so the sign-in page can tell a
   * user push is unavailable without first authenticating.
   */
  config: publicProcedure.query(() => ({
    enabled: pushEnabled(),
    publicKey: vapidPublicKey(),
  })),

  /** Is THIS browser subscribed? Keyed on the endpoint the browser reports. */
  status: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }).optional())
    .query(async ({ ctx, input }) => {
      const devices = await db.pushSubscription.count({
        where: { userId: ctx.userId, expiredAt: null },
      });
      if (!input?.endpoint) return { subscribedHere: false, devices };
      const here = await db.pushSubscription.findFirst({
        where: { userId: ctx.userId, endpoint: input.endpoint, expiredAt: null },
        select: { id: true },
      });
      return { subscribedHere: Boolean(here), devices };
    }),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        userAgent: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Upsert on endpoint, because a browser that re-subscribes hands back the
      // same one. Creating instead would collide on the unique index, and
      // ignoring the collision would leave the row pointing at whoever
      // subscribed first — so the userId is reassigned here on purpose: a
      // shared machine's second user takes over that browser's subscription
      // rather than silently notifying the first.
      await db.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId: ctx.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        },
        update: {
          userId: ctx.userId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
          expiredAt: null,
        },
      });
      return { ok: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      // Scoped to the caller: an endpoint is guessable in principle, and
      // deleting by endpoint alone would let one account silence another's.
      await db.pushSubscription.deleteMany({
        where: { endpoint: input.endpoint, userId: ctx.userId },
      });
      return { ok: true };
    }),
});
