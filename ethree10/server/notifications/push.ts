import webpush from "web-push";
import { db } from "@/server/db/client";
import { captureCriticalFailure } from "@/lib/observability";

/**
 * Web Push delivery.
 *
 * Push is the third notification channel alongside email and WhatsApp. The
 * schema already anticipated it — `NotificationPreference.push` and
 * `Notification.pushedAt` have existed since the model was written — but
 * nothing ever sent one.
 *
 * VAPID is how a push service knows the sender is us. The private key is a
 * server secret; the public key is handed to the browser at subscribe time and
 * is not sensitive. Generate a pair with:
 *
 *   pnpm exec web-push generate-vapid-keys
 *
 * Without keys configured, every function here is a no-op that says so once,
 * rather than throwing on a path that is only ever a side effect of something
 * more important. A failed notification must never roll back the action that
 * caused it.
 */

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  /** Collapses repeats of the same thing instead of stacking them. */
  tag?: string;
};

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] || "mailto:softdevs@theincubatorhub.org";

  if (!publicKey || !privateKey) {
    // Once, not per notification. A missing key is a deployment fact, not an
    // event, and logging it per send buries everything else.
    console.warn("[push] VAPID keys are not set — push notifications are disabled.");
    configured = false;
    return configured;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return configured;
}

/** The key the browser needs to subscribe. Safe to expose; it is public by design. */
export function vapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

export function pushEnabled(): boolean {
  return ensureConfigured();
}

/**
 * Send to every live subscription a user has, and return whether any landed.
 *
 * A user is a set of browsers, so one notification is several sends. Failures
 * are per-endpoint: one dead phone must not stop the laptop being notified.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<boolean> {
  if (!ensureConfigured()) return false;

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId, expiredAt: null },
  });
  if (subscriptions.length === 0) return false;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url ?? "/notifications",
    tag: payload.tag,
    timestamp: Date.now(),
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        await db.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastUsedAt: new Date() },
        });
        return true;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        // 404 and 410 are the push service telling us this endpoint is gone for
        // good — the user cleared site data, uninstalled, or the browser rotated
        // it. Marking it expired is the whole reason delivery does not silently
        // degrade over months into sending to nobody.
        if (status === 404 || status === 410) {
          await db.pushSubscription.update({
            where: { id: subscription.id },
            data: { expiredAt: new Date() },
          });
          return false;
        }

        // Anything else is ours to look at: a bad payload, a rejected VAPID
        // signature, or the push service being down.
        captureCriticalFailure("push-send", error, {
          endpointHost: safeHost(subscription.endpoint),
          statusCode: String(status ?? "unknown"),
        });
        return false;
      }
    }),
  );

  return results.some((r) => r.status === "fulfilled" && r.value === true);
}

/** The push service's host, for diagnostics. Never the full endpoint — it is a credential. */
function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable";
  }
}
