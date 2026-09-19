import { describe, expect, it } from "vitest";
import { parseViolationLog, groupViolations } from "@/lib/csp-log";
import type { ViolationSummary } from "@/lib/csp-report";

/**
 * Reading the violation log back has one job: answer what breaks if the policy
 * is enforced. A flat list of violations does not answer it — the same cause
 * repeats across thousands of page views, and the decision is per cause.
 */
const line = (summary: Partial<ViolationSummary>) =>
  `2026-09-19T10:00:00.000Z [csp-violation] ${JSON.stringify({
    directive: null,
    blocked: null,
    document: null,
    source: null,
    line: null,
    sample: null,
    ...summary,
  })}`;

describe("parseViolationLog", () => {
  it("finds violations among ordinary log noise", () => {
    // An application log is mostly not this. Everything else must be skipped
    // without comment rather than treated as a parse failure.
    const log = [
      "  ▲ Next.js 16.3.4",
      line({ directive: "script-src", blocked: "inline" }),
      "GET /dashboard 200 in 41ms",
      line({ directive: "img-src", blocked: "https://evil.example/p.png" }),
      "",
    ].join("\n");

    const found = parseViolationLog(log);
    expect(found).toHaveLength(2);
    expect(found[0]!.blocked).toBe("inline");
  });

  it("keeps going past a line the log rotated through mid-write", () => {
    // A clipped line is normal at a rotation boundary. Abandoning the rest of
    // the file because of one would quietly under-report.
    const log = [
      line({ directive: "script-src", blocked: "inline" }),
      "2026-09-19T10:00:00.000Z [csp-violation] {\"directive\":\"img-sr",
      line({ directive: "style-src", blocked: "inline" }),
    ].join("\n");

    expect(parseViolationLog(log)).toHaveLength(2);
  });

  it("returns nothing for a log with no violations, without throwing", () => {
    expect(parseViolationLog("just some logs\nand more\n")).toEqual([]);
    expect(parseViolationLog("")).toEqual([]);
  });

  it("ignores a line whose payload is not an object", () => {
    const log = [
      `[csp-violation] "a string"`,
      `[csp-violation] [1,2,3]`,
      line({ directive: "script-src", blocked: "eval" }),
    ].join("\n");
    expect(parseViolationLog(log)).toHaveLength(1);
  });
});

describe("groupViolations", () => {
  const make = (directive: string, blocked: string, document?: string) =>
    ({ directive, blocked, document: document ?? null, source: null, line: null, sample: null }) as ViolationSummary;

  it("collapses repeats into one cause with a count", () => {
    const groups = groupViolations([
      make("script-src", "inline", "https://x/a"),
      make("script-src", "inline", "https://x/b"),
      make("script-src", "inline", "https://x/a"),
      make("img-src", "https://evil.example/p.png", "https://x/a"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.blocked).toBe("inline");
    // Distinct pages, not occurrences — "everywhere" and "one page twice" are
    // different decisions.
    expect(groups[0]!.totalDocuments).toBe(2);
  });

  it("orders by count, commonest first", () => {
    const groups = groupViolations([
      make("img-src", "one"),
      make("script-src", "many"),
      make("script-src", "many"),
      make("script-src", "many"),
    ]);
    expect(groups.map((g) => g.blocked)).toEqual(["many", "one"]);
  });

  it("orders equal counts stably, so a rerun does not look like a change", () => {
    const input = [make("style-src", "b"), make("script-src", "a")];
    const first = groupViolations(input).map((g) => `${g.directive} ${g.blocked}`);
    const second = groupViolations([...input].reverse()).map((g) => `${g.directive} ${g.blocked}`);
    expect(first).toEqual(second);
  });

  it("caps the pages listed but still reports the true total", () => {
    // Printing four thousand URLs is not a report. Losing the count would hide
    // the difference between a site-wide problem and a local one.
    const many = Array.from({ length: 40 }, (_, i) => make("script-src", "inline", `https://x/page-${i}`));
    const [group] = groupViolations(many);
    expect(group!.documents.length).toBeLessThanOrEqual(5);
    expect(group!.totalDocuments).toBe(40);
    expect(group!.count).toBe(40);
  });

  it("does not drop a violation that arrived without a directive", () => {
    // Older browsers and odd payloads. Silently discarding them would
    // under-report exactly the cases worth looking at by hand.
    const [group] = groupViolations([make(null as never, null as never)]);
    expect(group!.directive).toBe("(unknown)");
    expect(group!.blocked).toBe("(unknown)");
    expect(group!.count).toBe(1);
  });

  it("returns nothing for no input", () => {
    expect(groupViolations([])).toEqual([]);
  });
});
