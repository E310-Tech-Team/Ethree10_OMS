import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, reportingEndpoints, CSP_REPORT_PATH, CSP_REPORT_GROUP } from "@/lib/csp.mjs";

/**
 * The policy shipped Report-Only with no report-uri and no report-to, so it
 * neither blocked anything nor recorded anything. QA read it as "monitors but
 * does not block"; it was not monitoring either, and the recommended next step
 * — review the reports — had no reports to review.
 */
describe("the policy names somewhere to send reports", () => {
  it("carries both report-uri and report-to", () => {
    // report-uri is deprecated and is the only one Safari implements; report-to
    // is what Chrome uses. Shipping one collects from some browsers and calls
    // it coverage.
    const policy = contentSecurityPolicy();
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain(`report-to ${CSP_REPORT_GROUP}`);
  });

  it("declares the endpoint group that report-to refers to", () => {
    // A report-to naming a group with no Reporting-Endpoints header goes
    // nowhere, silently — the exact failure being fixed.
    const header = reportingEndpoints();
    expect(header).toContain(CSP_REPORT_GROUP);
    expect(header).toContain(CSP_REPORT_PATH);
  });

  it("gives Reporting-Endpoints an absolute URL when an origin is configured", () => {
    // A relative path is silently rejected: the header parses, the group looks
    // present in devtools, and nothing is ever delivered. Measured — 186
    // violations detected by the browser, zero posted. Chrome also ignores
    // report-uri whenever report-to exists, so getting this wrong means Chrome
    // reports nothing at all rather than falling back.
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://oms.ethree10.com/";
    try {
      expect(reportingEndpoints()).toBe('csp="https://oms.ethree10.com/api/csp-report"');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("reports to our own origin", () => {
    // A relative path: no third party receives the URLs of pages our users
    // visit, and there is no CORS preflight to get wrong.
    expect(CSP_REPORT_PATH.startsWith("/")).toBe(true);
  });
});

describe("what the policy allows", () => {
  const policy = () => contentSecurityPolicy();

  it("no longer allows eval, because production never used it", () => {
    // Measured two ways: zero of 84 built client chunks and zero server files
    // contain eval( or new Function(, and a real page load in a browser
    // produced no eval violation against a production build.
    //
    // Vitest runs with NODE_ENV=test, so this is the non-development policy.
    expect(process.env.NODE_ENV).not.toBe("development");
    expect(policy()).not.toContain("'unsafe-eval'");
  });

  it("keeps the directives that were already doing work", () => {
    // These three are the ones with teeth in the current policy, and the
    // production header check asserts them too. Losing one to a careless edit
    // would be invisible.
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) {
      expect(policy()).toContain(directive);
    }
  });

  it("still allows inline script, and that is deliberate", () => {
    // Not an oversight. A served page carries two of Next's own RSC payload
    // scripts inline; removing this needs a per-request nonce generated in
    // middleware, not an edit here. Asserting it keeps the state honest — when
    // the nonce migration lands, this test is what says so.
    expect(policy()).toContain("'unsafe-inline'");
  });

  it("keeps the payment and analytics origins it needs", () => {
    const p = policy();
    expect(p).toContain("https://js.paystack.co");
    expect(p).toContain("https://checkout.paystack.com");
    expect(p).toContain("https://*.posthog.com");
  });
});

import { normalizeReports, summarizeViolation, truncate, MAX_FIELD } from "@/lib/csp-report";

/**
 * The two wire formats. `report-uri` sends one object with hyphenated keys;
 * `report-to` sends an array of envelopes with camelCase keys. Handling one and
 * not the other silently drops every report from the browsers using the other —
 * the same blind spot, with more code in front of it.
 */
describe("normalizeReports", () => {
  it("reads the legacy report-uri shape", () => {
    const body = { "blocked-uri": "inline", "violated-directive": "script-src" };
    expect(normalizeReports({ "csp-report": body })).toEqual([body]);
  });

  it("reads the modern Reporting-API array", () => {
    const body = { blockedURL: "inline", effectiveDirective: "script-src" };
    expect(normalizeReports([{ type: "csp-violation", body }])).toEqual([body]);
  });

  it("ignores other report types sharing the envelope", () => {
    // The Reporting API multiplexes deprecation and intervention reports down
    // the same endpoint. Logging those as CSP violations would bury the ones
    // that decide whether enforcing is safe.
    const csp = { blockedURL: "inline" };
    const reports = [
      { type: "deprecation", body: { id: "obsolete-api" } },
      { type: "csp-violation", body: csp },
      { type: "intervention", body: { id: "heavy-ad" } },
    ];
    expect(normalizeReports(reports)).toEqual([csp]);
  });

  it("keeps an envelope with no type", () => {
    // Some browsers omit it. Dropping those would lose real violations.
    const body = { blockedURL: "eval" };
    expect(normalizeReports([{ body }])).toEqual([body]);
  });

  it("survives anything that is not a report", () => {
    // The endpoint is unauthenticated and public, so the body is hostile until
    // proven otherwise. None of these may throw.
    for (const junk of [null, undefined, 42, "a string", [], [null], [1, 2], {}]) {
      expect(() => normalizeReports(junk)).not.toThrow();
      expect(Array.isArray(normalizeReports(junk))).toBe(true);
    }
  });
});

describe("summarizeViolation", () => {
  it("pulls the same fields out of either spelling", () => {
    const modern = summarizeViolation({
      effectiveDirective: "script-src-elem",
      blockedURL: "inline",
      documentURL: "https://oms.ethree10.com/login",
      lineNumber: 12,
    });
    const legacy = summarizeViolation({
      "effective-directive": "script-src-elem",
      "blocked-uri": "inline",
      "document-uri": "https://oms.ethree10.com/login",
      "line-number": 12,
    });
    expect(modern.directive).toBe(legacy.directive);
    expect(modern.blocked).toBe(legacy.blocked);
    expect(modern.document).toBe(legacy.document);
  });

  it("falls back to violated-directive when effective is absent", () => {
    // Older browsers send only the deprecated field. Reading one key would make
    // every report from them show a blank directive — the one field that
    // decides whether a policy change is safe.
    expect(summarizeViolation({ "violated-directive": "style-src" }).directive).toBe("style-src");
  });

  it("caps every field so one report cannot own the log", () => {
    const summary = summarizeViolation({ "blocked-uri": "x".repeat(5000) });
    expect(summary.blocked!.length).toBeLessThanOrEqual(MAX_FIELD + 1);
  });

  it("does not pass a non-numeric line number through", () => {
    // It is logged as JSON; a string or object here would be attacker-shaped
    // data in a field consumers will treat as a number.
    expect(summarizeViolation({ lineNumber: "not a number" }).line).toBeNull();
    expect(summarizeViolation({ lineNumber: { nested: true } }).line).toBeNull();
  });

  it("returns nulls rather than throwing on an empty body", () => {
    expect(summarizeViolation({})).toEqual({
      directive: null, blocked: null, document: null, source: null, line: null, sample: null,
    });
  });
});

describe("truncate", () => {
  it("leaves short strings alone and rejects non-strings", () => {
    expect(truncate("script-src")).toBe("script-src");
    expect(truncate(123)).toBeNull();
    expect(truncate("")).toBeNull();
    expect(truncate(null)).toBeNull();
  });
});
