import { devLoginRisk } from "@/server/auth/dev-login";
import { DEFAULT_TEAMS } from "./request-types";

export type ReadinessStatus = "pass" | "warn" | "fail";

export type ReadinessCheck = {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
};

type EnvLike = Record<string, string | undefined>;

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "REDIS_URL",
  "INTEGRATION_SECRET_KEY",
  "STORAGE_ENDPOINT",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "STORAGE_BUCKET",
  "STORAGE_PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_STORAGE_URL",
] as const;

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /replace/i,
  /change/i,
  /example/i,
  /mock/i,
  /^re_replace_me$/,
  /^sk_test_mock$/,
  /^whsec_mock$/,
  /^a{64}$/,
];

function present(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

function isPlaceholder(value: string | undefined) {
  return !present(value) || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function isUrl(value: string | undefined) {
  if (!present(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isHttps(value: string | undefined) {
  if (!present(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function sameOrigin(a: string | undefined, b: string | undefined) {
  if (!isUrl(a) || !isUrl(b)) return false;
  return new URL(a as string).origin === new URL(b as string).origin;
}

function nodeMajor(version: string) {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function check(key: string, label: string, status: ReadinessStatus, detail: string): ReadinessCheck {
  return { key, label, status, detail };
}

export function evaluateEnvironmentReadiness(
  env: EnvLike,
  options: { production?: boolean; nodeVersion?: string } = {},
): ReadinessCheck[] {
  const production = options.production ?? env["NODE_ENV"] === "production";
  const checks: ReadinessCheck[] = [];

  const missing = REQUIRED_ENV_KEYS.filter((key) => !present(env[key]));
  checks.push(
    check(
      "env.required",
      "Required environment variables",
      missing.length === 0 ? "pass" : "fail",
      missing.length === 0 ? "All required variables are present." : `Missing: ${missing.join(", ")}`,
    ),
  );

  const placeholderKeys = REQUIRED_ENV_KEYS.filter((key) => isPlaceholder(env[key]));
  checks.push(
    check(
      "env.placeholders",
      "Production placeholders",
      placeholderKeys.length === 0 ? "pass" : production ? "fail" : "warn",
      placeholderKeys.length === 0
        ? "No required variable is using a placeholder value."
        : `Replace placeholder values for: ${placeholderKeys.join(", ")}`,
    ),
  );

  const urlKeys = ["AUTH_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL", "STORAGE_PUBLIC_URL", "NEXT_PUBLIC_STORAGE_URL"];
  const invalidUrls = urlKeys.filter((key) => present(env[key]) && !isUrl(env[key]));
  checks.push(
    check(
      "env.urls",
      "URL syntax",
      invalidUrls.length === 0 ? "pass" : "fail",
      invalidUrls.length === 0 ? "URL variables are syntactically valid." : `Invalid URLs: ${invalidUrls.join(", ")}`,
    ),
  );

  checks.push(
    check(
      "auth.url-alignment",
      "Auth URL alignment",
      sameOrigin(env["AUTH_URL"], env["NEXTAUTH_URL"]) && sameOrigin(env["AUTH_URL"], env["NEXT_PUBLIC_APP_URL"])
        ? "pass"
        : "fail",
      "AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must share the same public origin.",
    ),
  );

  const publicUrls = ["AUTH_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL", "STORAGE_PUBLIC_URL", "NEXT_PUBLIC_STORAGE_URL"];
  const nonHttps = publicUrls.filter((key) => present(env[key]) && !isHttps(env[key]));
  checks.push(
    check(
      "env.https",
      "HTTPS public URLs",
      production && nonHttps.length > 0 ? "fail" : nonHttps.length > 0 ? "warn" : "pass",
      nonHttps.length === 0 ? "Public URLs use HTTPS." : `Non-HTTPS URLs: ${nonHttps.join(", ")}`,
    ),
  );

  const integrationKey = env["INTEGRATION_SECRET_KEY"] ?? "";
  checks.push(
    check(
      "integrations.secret",
      "Integration encryption key",
      /^[0-9a-f]{64}$/i.test(integrationKey) && integrationKey !== "a".repeat(64) ? "pass" : "fail",
      "INTEGRATION_SECRET_KEY must be a non-placeholder 64-character hex key.",
    ),
  );

  const nodeVersion = options.nodeVersion ?? process.version;
  const major = nodeMajor(nodeVersion);
  checks.push(
    check(
      "runtime.node",
      "Node runtime",
      major === 24 ? "pass" : "fail",
      `Expected Node 24.x for deployment; current runtime is ${nodeVersion}.`,
    ),
  );

  // A warning, never a failure. Online card payment is not switched on yet, and
  // PaystackService already throws in production when the key is absent, so a
  // missing key cannot quietly take money — it can only stop a feature nobody
  // is using. Failing here instead blocked the whole readiness gate, which took
  // the post-deploy smoke test, security-header check and backup verification
  // down with it: an unused payment key was silently costing us the checks that
  // tell us production is alive. Turn this back into a failure the day invoices
  // are actually collected online.
  const paystackMissing = ["PAYSTACK_SECRET_KEY", "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"].filter((key) => isPlaceholder(env[key]));
  checks.push(
    check(
      "payments.paystack",
      "Paystack keys",
      paystackMissing.length === 0 ? "pass" : "warn",
      paystackMissing.length === 0
        ? "Paystack server and public keys are configured."
        : `Online payment is off until these are set: ${paystackMissing.join(", ")}. Invoices can still be issued and marked paid manually.`,
    ),
  );

  // Push is optional: without VAPID keys the app degrades to in-app and email
  // notifications, which is a reduced service rather than a broken one. A warn,
  // not a fail — the same reasoning as Paystack above. What it must not do is
  // pass silently, because a push channel that is configured in the UI and
  // sends nothing looks identical to one nobody turned on.
  const vapidMissing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((key) =>
    isPlaceholder(env[key]),
  );
  checks.push(
    check(
      "notifications.push",
      "Web Push keys",
      vapidMissing.length === 0 ? "pass" : "warn",
      vapidMissing.length === 0
        ? "VAPID keys are configured; browsers can subscribe to push."
        : `Push notifications are off until these are set: ${vapidMissing.join(", ")}. Generate a pair with \`pnpm exec web-push generate-vapid-keys\`. In-app and email notifications are unaffected.`,
    ),
  );

  // The provider this guards against signs anyone in from an email alone. The
  // code refuses it on a production domain regardless, so this is defence in
  // depth — but a deploy carrying the variable is a misconfiguration serious
  // enough to stop, not to mention in passing.
  const devLoginWarning = devLoginRisk({
    NODE_ENV: env["NODE_ENV"] ?? (production ? "production" : undefined),
    E2E_TEST_AUTH: env["E2E_TEST_AUTH"],
    NEXT_PUBLIC_APP_URL: env["NEXT_PUBLIC_APP_URL"],
  });
  checks.push(
    check(
      "auth.dev-login",
      "Password-less dev login",
      devLoginWarning ? "fail" : "pass",
      devLoginWarning ?? "The dev-only credentials provider cannot be enabled here.",
    ),
  );

  // Split from a single "Observability keys" warning, which lumped error
  // reporting together with product analytics and so said nothing about what
  // each absence costs. Both stay warnings rather than failures: readiness is a
  // hard gate on the deploy, and failing it here would skip the smoke test,
  // security-header check and backup verification — trading the checks that
  // confirm production is alive for a missing key. That is the exact trade the
  // Paystack check used to make.
  const sentryMissing = ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"].filter((key) => isPlaceholder(env[key]));
  checks.push(
    check(
      "observability.sentry",
      "Error reporting",
      sentryMissing.length === 0 ? "pass" : "warn",
      sentryMissing.length === 0
        ? "Sentry is configured; unhandled errors are reported."
        : `No Sentry DSN (${sentryMissing.join(", ")}). instrumentation.ts initialises but reports nowhere, so ` +
          "the error boundaries and every captureCriticalFailure call — payment confirmation, receipt issuance, " +
          "report delivery — are writing to a log nobody reads.",
    ),
  );

  const analyticsMissing = ["NEXT_PUBLIC_POSTHOG_KEY"].filter((key) => isPlaceholder(env[key]));
  checks.push(
    check(
      "observability.analytics",
      "Product analytics",
      analyticsMissing.length === 0 ? "pass" : "warn",
      analyticsMissing.length === 0
        ? "PostHog is configured."
        : "No PostHog key. No product events are sent; the admin analytics page reports this rather than claiming otherwise.",
    ),
  );

  return checks;
}

export type DatabaseReadinessCounts = {
  teams: number;
  teamsWithHeads: number;
  services: number;
  acceptedStaff: number;
  superAdmins: number;
  organizations: number;
};

export function evaluateDatabaseReadiness(counts: DatabaseReadinessCounts): ReadinessCheck[] {
  return [
    check(
      "data.teams",
      "Canonical branches",
      counts.teams >= DEFAULT_TEAMS.length ? "pass" : "fail",
      // Names come from DEFAULT_TEAMS rather than being written out here. This
      // message previously named "Product Development" and "Brands &
      // Communications", which the agency renamed to Digital Media and Tech &
      // Product — so a real failure was reported against branches that no
      // longer exist, and anyone acting on it would have created the wrong two.
      `Found ${counts.teams} active branches; expected ${DEFAULT_TEAMS.length}: ${DEFAULT_TEAMS.map((t) => t.name).join(" and ")}.`,
    ),
    check(
      "data.team-heads",
      "Team heads",
      counts.teams > 0 && counts.teamsWithHeads === counts.teams ? "pass" : "warn",
      `${counts.teamsWithHeads}/${counts.teams} active teams have a lead assigned.`,
    ),
    check(
      "data.services",
      "Service catalog",
      counts.services > 0 ? "pass" : "fail",
      `Found ${counts.services} active services.`,
    ),
    check(
      "data.staff",
      "Accepted staff",
      counts.acceptedStaff > 1 ? "pass" : "warn",
      `Found ${counts.acceptedStaff} accepted staff memberships.`,
    ),
    check(
      "data.super-admin",
      "Super admin",
      counts.superAdmins > 0 ? "pass" : "fail",
      `Found ${counts.superAdmins} super-admin users.`,
    ),
    check(
      "data.organizations",
      "Organizations",
      counts.organizations > 0 ? "pass" : "warn",
      `Found ${counts.organizations} organizations.`,
    ),
  ];
}

export function summarizeReadiness(checks: ReadinessCheck[]) {
  return {
    passed: checks.filter((item) => item.status === "pass").length,
    warnings: checks.filter((item) => item.status === "warn").length,
    failures: checks.filter((item) => item.status === "fail").length,
  };
}

export function formatReadinessReport(checks: ReadinessCheck[]) {
  const icon: Record<ReadinessStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const lines = checks.map((item) => `${icon[item.status]} ${item.label}: ${item.detail}`);
  const summary = summarizeReadiness(checks);
  return [
    "Ethree10 launch readiness",
    `Summary: ${summary.passed} passed, ${summary.warnings} warnings, ${summary.failures} failures`,
    "",
    ...lines,
  ].join("\n");
}
