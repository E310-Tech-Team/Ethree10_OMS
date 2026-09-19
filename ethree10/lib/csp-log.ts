import type { ViolationSummary } from "@/lib/csp-report";

/**
 * Reading the violation log back as an answer to one question: what breaks if
 * the policy is enforced?
 *
 * A list of individual violations does not answer it. The same directive and
 * the same blocked resource repeat thousands of times across pages, and the
 * thing worth deciding is per (directive, blocked) pair — "eval, 4000 times,
 * on every page" is a blocker; "an unapproved analytics host, twice, on one
 * page" is a line to add or a script to remove.
 *
 * Pure, so the aggregation is tested rather than inferred from whether a
 * workflow's output looked plausible.
 */

export type ViolationGroup = {
  directive: string;
  blocked: string;
  count: number;
  /** Distinct pages it happened on, capped — enough to tell "everywhere" from "one page". */
  documents: string[];
  totalDocuments: number;
};

/** Beyond a handful, the list stops informing and starts scrolling. */
const MAX_DOCUMENTS = 5;

const LOG_PREFIX = "[csp-violation]";

/**
 * Pull the summaries back out of the log.
 *
 * Lines are matched on the prefix and parsed as the JSON that follows it.
 * Anything else in the file — and an application log is full of anything else —
 * is skipped silently rather than treated as a parse failure worth reporting.
 */
export function parseViolationLog(contents: string): ViolationSummary[] {
  const out: ViolationSummary[] = [];

  for (const line of contents.split("\n")) {
    const at = line.indexOf(LOG_PREFIX);
    if (at === -1) continue;

    const json = line.slice(at + LOG_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as ViolationSummary);
      }
    } catch {
      // A truncated line — the log rotated mid-write, or the line was clipped.
      // One unreadable entry is not a reason to abandon the rest.
    }
  }

  return out;
}

/** Group by what would have to change, commonest first. */
export function groupViolations(violations: ViolationSummary[]): ViolationGroup[] {
  const groups = new Map<
    string,
    { directive: string; blocked: string; count: number; documents: Set<string> }
  >();

  for (const violation of violations) {
    const directive = violation.directive ?? "(unknown)";
    const blocked = violation.blocked ?? "(unknown)";
    const key = `${directive} ${blocked}`;

    const existing =
      groups.get(key) ?? { directive, blocked, count: 0, documents: new Set<string>() };
    existing.count += 1;
    if (violation.document) existing.documents.add(violation.document);
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      directive: group.directive,
      blocked: group.blocked,
      count: group.count,
      documents: [...group.documents].slice(0, MAX_DOCUMENTS),
      totalDocuments: group.documents.size,
    }))
    // Commonest first, then alphabetically so equal counts do not shuffle
    // between runs and look like a change when nothing changed.
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.directive.localeCompare(b.directive) ||
        a.blocked.localeCompare(b.blocked),
    );
}
