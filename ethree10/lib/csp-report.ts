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

/**
 * Routes whose path carries a secret.
 *
 * /track/<token>, /invoice/<code> and /receipt/<code> are opened by a link
 * alone — the code IS the authorisation, which is why those codes are drawn
 * from the CSPRNG. A violation report names the document it happened on, so
 * logging the URL verbatim writes a live bearer token into the application log,
 * and from there into the output of any workflow that reads it back.
 */
const SECRET_SEGMENT_AFTER = new Set(["track", "invoice", "receipt"]);

/** Long, opaque and meaningless to a reader: a cuid, a token, a storage key. */
const OPAQUE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * A URL reduced to the part that helps and stripped of the part that leaks.
 *
 * Deciding whether a CSP change is safe needs the ROUTE — which page, which
 * directive. It never needs which invoice. So the query string and fragment go
 * (both carry tokens), and any segment that is either a known secret position
 * or simply opaque is masked.
 *
 * Anything unparseable is dropped entirely rather than passed through: a value
 * we cannot reason about is not one to copy into a log.
 */
export function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  // "inline", "eval", "data" and similar keywords are not URLs, and are the
  // most important values in the whole report.
  if (!value.includes("://")) return truncate(value);

  let url: URL;
  try {
    // Parsed BEFORE truncating. Truncating first appends an ellipsis and makes
    // a long URL unparseable, which would silently drop the field rather than
    // shorten it — losing exactly the long URLs most worth looking at.
    url = new URL(value);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/");
  const masked = segments.map((segment, index) => {
    if (!segment) return segment;
    const previous = segments[index - 1];
    if (previous && SECRET_SEGMENT_AFTER.has(previous)) return "<redacted>";
    if (OPAQUE.test(segment)) return "<redacted>";
    return segment;
  });

  // Origin and path only. No search, no hash. Truncated last, once it is
  // already safe to look at.
  return truncate(`${url.origin}${masked.join("/")}`);
}

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
    blocked: sanitizeUrl(body["blockedURL"] ?? body["blocked-uri"]),
    // Sanitized, not raw: these are the two fields that carry a page URL, and
    // some of this app's page URLs are bearer tokens.
    document: sanitizeUrl(body["documentURL"] ?? body["document-uri"]),
    source: sanitizeUrl(body["sourceFile"] ?? body["source-file"]),
    line: typeof rawLine === "number" ? rawLine : null,
    sample: pick("scriptSample", "script-sample"),
  };
}
