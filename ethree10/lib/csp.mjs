/**
 * The Content Security Policy, and the state of the migration towards
 * enforcing it.
 *
 * The policy has been shipping in Report-Only mode with no `report-uri` and no
 * `report-to`. Report-Only means it blocks nothing; no reporting endpoint means
 * it records nothing. It has therefore been doing neither of the two things a
 * CSP can do — QA read it as "monitors problems but does not yet block them",
 * and it was not monitoring either. The recommended next step, "review the CSP
 * reports and approve legitimate sources", had no reports to review.
 *
 * This file adds the endpoint so that data starts existing. Enforcing comes
 * after there is evidence, not before.
 *
 * ── What the measurements said ───────────────────────────────────────────────
 *
 * `'unsafe-eval'`: removed in production, kept in development.
 *
 * Zero of 84 built client chunks and zero server files contain `eval(` or
 * `new Function(` — production never needed it. Development does: Next's
 * dev-time hot reload evaluates strings, and dropping it everywhere produced
 * 186 violations on a single page load. That is not a fault to fix; it is the
 * dev server working. Leaving it on in dev keeps the report stream meaningful,
 * because an endpoint whose output is almost entirely expected noise gets
 * ignored, and then the one real violation is ignored with it.
 *
 * This split was found by loading the app rather than by reading the build
 * output — the static scan said prod was clean and was right about prod, and
 * said nothing at all about dev.
 *
 * `script-src 'unsafe-inline'`: still required, and cannot be dropped by
 * wishing. A served page carries three inline scripts — our service worker
 * registration (now moved to a file, see /sw-register.js) and two of Next's own
 * RSC payload scripts (`self.__next_f.push(...)`). Next's cannot be removed;
 * they need a per-request nonce, which means generating one in middleware and
 * building this header there instead of here. That is the next step and it is
 * a real change, not a one-line edit.
 *
 * `style-src 'unsafe-inline'`: required, and likely permanent. The pages carry
 * inline `style=` attributes — animation delays, and `color:transparent` from
 * next/image. Nonces do not cover style *attributes*, only `<style>` elements,
 * so no nonce migration removes this one. It is also the least dangerous of the
 * three: injecting CSS is not injecting script.
 */

/** Where violation reports are posted. Same origin, so no CORS and no third party. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Named group for the modern Reporting API. Must match the Reporting-Endpoints header. */
export const CSP_REPORT_GROUP = "csp";

/**
 * Next's dev server evaluates strings for hot reload. This is the only
 * difference between the two policies, and it is deliberately expressed as one
 * flag rather than two separate lists that could drift apart.
 */
const isDev = process.env.NODE_ENV === "development";

const scriptSrc = [
  "script-src 'self' 'unsafe-inline'",
  isDev ? "'unsafe-eval'" : null,
  "https://js.paystack.co https://*.posthog.com https://app.posthog.com",
]
  .filter(Boolean)
  .join(" ");

const DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self' https://checkout.paystack.com",
  "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com",
  // 'unsafe-eval' only in dev, see above. 'unsafe-inline' stays everywhere
  // until the nonce migration.
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io https://api.paystack.co https://checkout.paystack.com https://*.posthog.com https://app.posthog.com",
  "frame-src https://checkout.paystack.com",
];

/**
 * Both reporting mechanisms on purpose.
 *
 * `report-uri` is deprecated and is what Safari and older Firefox implement;
 * `report-to` is the replacement and is what Chrome uses. Shipping only the
 * modern one collects from roughly the Chrome share of users and calls it
 * coverage.
 *
 * Chrome ignores `report-uri` entirely when `report-to` is present, so the two
 * are not belt-and-braces for the same browser — each one is the only mechanism
 * for the browsers that use it. That also means a broken `report-to` makes
 * Chrome send nothing at all rather than falling back, which is exactly what
 * happened during testing and is why `reportingEndpoints` below is careful
 * about the URL.
 */
export function contentSecurityPolicy() {
  return [...DIRECTIVES, `report-uri ${CSP_REPORT_PATH}`, `report-to ${CSP_REPORT_GROUP}`].join("; ");
}

/**
 * The Reporting-Endpoints header, which `report-to` above refers to by name.
 *
 * The URL must be ABSOLUTE. A relative path here is silently rejected — the
 * header parses, the group appears to exist, the policy looks correct in
 * devtools, and no report is ever sent. Found by loading a page with a real
 * violation and watching the browser log it and post nothing: 186 violations
 * detected, zero delivered.
 *
 * Chrome also requires the endpoint to be a secure origin, so reports do not
 * flow over plain http in local development. Production is HTTPS, which is
 * where this has to work.
 */
export function reportingEndpoints() {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  // With no configured origin there is no absolute URL to build. The relative
  // form does not work for report-to, but report-uri still resolves it, so
  // Safari and Firefox keep reporting rather than nobody reporting.
  const url = origin ? `${origin}${CSP_REPORT_PATH}` : CSP_REPORT_PATH;
  return `${CSP_REPORT_GROUP}="${url}"`;
}
