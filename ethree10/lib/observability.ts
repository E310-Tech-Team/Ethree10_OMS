import * as Sentry from "@sentry/nextjs";

/**
 * Error monitoring.
 *
 * `@sentry/nextjs` was a dependency and `SENTRY_DSN` was in the env schema, but
 * nothing ever initialised it — in production a failed payment confirmation or a
 * failed report cycle was visible only in server logs nobody watches.
 *
 * Everything here degrades to a console write when no DSN is configured, so local
 * development and tests behave exactly as before.
 */

const DSN = process.env["SENTRY_DSN"] ?? process.env["NEXT_PUBLIC_SENTRY_DSN"] ?? "";

export const isMonitoringEnabled = DSN.length > 0;

let initialised = false;

/** Idempotent. Safe to call from every entry point. */
export function initMonitoring(runtime: "server" | "client" | "edge" = "server"): void {
  if (initialised || !isMonitoringEnabled) return;
  initialised = true;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    // Sampled: full tracing on a startup-scale hosting budget is not worth it.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    // Never ship request bodies — they contain client briefs and personal data.
    sendDefaultPii: false,
    beforeSend(event) {
      // Tracking tokens are capability URLs. They must never reach a third party.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/\/track\/[^/?#]+/g, "/track/[redacted]");
      }
      return event;
    },
    initialScope: { tags: { runtime } },
  });
}

/**
 * Jobs whose silent failure would go unnoticed and cause real harm. Naming them
 * explicitly means an alert rule can be written against the tag rather than
 * against free-text message matching.
 */
export type CriticalJob =
  | "report-cycle"
  | "report-delivery"
  | "payment-confirmation"
  | "receipt-issuance"
  | "notification-worker"
  | "push-send"
  | "integration-sync"
  | "file-storage"
  // Unhandled render failures caught by the route error boundaries.
  | "app-route-error"
  | "global-error";

/**
 * Report a failure in a critical path. Always logs; also reports to Sentry when
 * configured, tagged so it can be alerted on.
 */
export function captureCriticalFailure(
  job: CriticalJob,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[critical:${job}] ${message}`, context ?? {});

  if (!isMonitoringEnabled) return;
  initMonitoring();
  Sentry.withScope((scope) => {
    scope.setTag("critical_job", job);
    scope.setLevel("error");
    if (context) scope.setContext("job", context);
    Sentry.captureException(error instanceof Error ? error : new Error(message));
  });
}

/** Report an unhandled server render or route-handler error. */
export function captureRequestError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[request] ${message}`, context ?? {});
  if (!isMonitoringEnabled) return;
  initMonitoring();
  Sentry.withScope((scope) => {
    scope.setLevel("error");
    if (context) scope.setContext("request", context);
    Sentry.captureException(error instanceof Error ? error : new Error(message));
  });
}

/** Record that a scheduled job finished, so a missing heartbeat is detectable. */
export function recordJobSuccess(job: CriticalJob, context?: Record<string, unknown>): void {
  if (!isMonitoringEnabled) return;
  initMonitoring();
  Sentry.addBreadcrumb({
    category: "job",
    level: "info",
    message: `${job} completed`,
    data: context,
  });
}
