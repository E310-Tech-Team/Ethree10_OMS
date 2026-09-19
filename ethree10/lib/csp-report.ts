/**
 * Parsing CSP violation reports, which arrive in two incompatible shapes.
 *
 * `report-uri` posts `application/csp-report` as a single object
 * `{"csp-report": {...}}` with hyphenated keys (`blocked-uri`).
 * `report-to` posts `application/reports+json` as an ARRAY of `{type, body}`
 * with camelCase keys (`blockedURL`).
 *
 * Handling one and not the other silently drops every report from the browsers
 * that use the other — which would leave the same blind spot this whole change
 * exists to remove, just with more code in front of it.
 *
 * Pure, so the shapes can be tested directly instead of inferred from whether
 * anything shows up in a log.
 */

/** Long enough to identify the offending resource, short enough to bound a log line. */
export const MAX_FIELD = 300;

export type ViolationSummary = {
  /** The directive that would have blocked it — the field that says whether a change is safe. */
  directive: string | null;
  /** What was blocked. "inline" and "eval" are the answers that decide the nonce migration. */
  blocked: string | null;
  document: string | null;
  source: string | null;
  line: number | null;
  /** Present only for inline violations: the first characters of the offending script. */
  sample: string | null;
};

export function truncate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
}

/** Both wire formats in, a flat list of violation bodies out. */
export function normalizeReports(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type?: string; body?: unknown } =>
          Boolean(entry) && typeof entry === "object",
      )
      // A Reporting-API envelope carries other report types too (deprecation,
      // intervention, network-error). Only CSP violations belong here; an
      // absent type is treated as one, since some browsers omit it.
      .filter((entry) => entry.type === undefined || entry.type === "csp-violation")
      .map((entry) => entry.body)
      .filter((body): body is Record<string, unknown> => Boolean(body) && typeof body === "object");
  }

  if (payload && typeof payload === "object") {
    const legacy = (payload as Record<string, unknown>)["csp-report"];
    if (legacy && typeof legacy === "object") return [legacy as Record<string, unknown>];
    return [payload as Record<string, unknown>];
  }

  return [];
}

export function summarizeViolation(body: Record<string, unknown>): ViolationSummary {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = truncate(body[key]);
      if (value) return value;
    }
    return null;
  };

  const rawLine = body["lineNumber"] ?? body["line-number"];

  return {
    directive: pick(
      "effectiveDirective",
      "effective-directive",
      "violatedDirective",
      "violated-directive",
    ),
    blocked: pick("blockedURL", "blocked-uri"),
    document: pick("documentURL", "document-uri"),
    source: pick("sourceFile", "source-file"),
    line: typeof rawLine === "number" ? rawLine : null,
    sample: pick("scriptSample", "script-sample"),
  };
}
