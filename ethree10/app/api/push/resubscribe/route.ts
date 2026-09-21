import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { clientIp } from "@/server/security/client-ip";
import { enforcePublicRateLimit } from "@/server/security/public-rate-limit";

/**
 * Chrome rotates push subscriptions. When it does it fires
 * `pushsubscriptionchange` in the service worker, and if nothing acts on that
 * the subscription dies silently — the user simply stops receiving anything,
 * with no error on either side. This is what keeps that from happening.
 *
 * Deliberately NOT session-authenticated. The event can fire with no page open
 * and no session to read, and the old endpoint is itself the proof: it is a
 * capability URL that only the browser holding that subscription knows. So the
 * rule is "whoever presents the old endpoint may replace it", and the row's
 * userId is never taken from the request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  oldEndpoint: z.string().url().nullable(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
});

export async function POST(request: Request) {
  try {
    await enforcePublicRateLimit({
      action: "push.resubscribe",
      secret: clientIp(request.headers) ?? "unknown",
      limit: 20,
      windowSeconds: 3600,
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  let parsed;
  try {
    parsed = schema.parse(await request.json());
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const { oldEndpoint, subscription } = parsed;
  if (!oldEndpoint) return new NextResponse(null, { status: 204 });

  const existing = await db.pushSubscription.findUnique({ where: { endpoint: oldEndpoint } });
  // Unknown old endpoint: nothing to migrate, and nothing to tell the caller.
  // Answering 404 here would confirm which endpoints exist.
  if (!existing) return new NextResponse(null, { status: 204 });

  await db.pushSubscription.update({
    where: { id: existing.id },
    data: {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expiredAt: null,
    },
  });

  return new NextResponse(null, { status: 204 });
}
