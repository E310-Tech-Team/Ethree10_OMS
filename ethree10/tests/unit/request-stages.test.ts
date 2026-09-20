import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { RequestStage } from "@prisma/client";
import {
  ALLOWED_TRANSITIONS,
  APPROVABLE_FROM,
  canApprove,
  canReject,
  canRequestClarification,
  canTransition,
  nextStagesFor,
  stageGuidance,
} from "@/lib/request-stages";

/**
 * The triage panel offered Accept, Request clarification and Reject at every
 * stage. On a request already at `in_progress` all three are refused by the
 * server, so the panel showed three prominent buttons, none of which could
 * work, above a quiet dropdown that was the only thing that did.
 *
 * Someone trying to move the work forward clicks the obvious one and gets
 * "Request cannot be accepted from in_progress", with nothing to say the real
 * next step is on the project.
 */
const ALL_STAGES = Object.keys(ALLOWED_TRANSITIONS) as RequestStage[];

describe("the transition table is the only copy", () => {
  it("is no longer duplicated in the request detail page", () => {
    // The page carried its own copy commented "mirrors the server-side guard".
    // Two copies of one rule is the drift this codebase already learned about
    // with role arrays: they agreed the day they were written, and nothing kept
    // them agreeing.
    const page = readFileSync(join(process.cwd(), "app/(app)/requests/[id]/page.tsx"), "utf8");
    expect(page).not.toContain("NEXT_STAGES");
    expect(page).toContain("@/lib/request-stages");
  });

  it("is the table the server guard reads", () => {
    const service = readFileSync(join(process.cwd(), "server/services/request.ts"), "utf8");
    expect(service).toContain('from "@/lib/request-stages"');
    // The guard must not re-declare it.
    expect(service).not.toMatch(/const ALLOWED_TRANSITIONS[^=]*=\s*\{/);
  });

  it("the approve guard reads APPROVABLE_FROM rather than its own literal", () => {
    // The stage list was inline in the service. If it is re-inlined, the
    // buttons and the guard can disagree again.
    const service = readFileSync(join(process.cwd(), "server/services/request.ts"), "utf8");
    expect(service).toContain("APPROVABLE_FROM.includes(before.stage)");
  });

  it("covers every stage, so no stage falls through to an empty list by accident", () => {
    // A missing key and a deliberate dead end both read as "no transitions".
    // Being exhaustive is what makes the empty ones meaningful.
    expect(ALL_STAGES).toHaveLength(14);
    for (const stage of ALL_STAGES) {
      expect(Array.isArray(ALLOWED_TRANSITIONS[stage])).toBe(true);
    }
  });

  it("only names real stages as destinations", () => {
    for (const stage of ALL_STAGES) {
      for (const next of nextStagesFor(stage)) {
        expect(ALL_STAGES).toContain(next);
      }
    }
  });

  it("treats terminal stages as terminal", () => {
    for (const stage of ["closed", "rejected", "cancelled"] as RequestStage[]) {
      expect(nextStagesFor(stage)).toEqual([]);
    }
  });
});

describe("a button is offered only where the action would succeed", () => {
  it("never offers Accept where the server would refuse it", () => {
    // The exact bug. `approve` accepts five stages; the panel showed the button
    // on all fourteen.
    for (const stage of ALL_STAGES) {
      expect(canApprove(stage)).toBe(APPROVABLE_FROM.includes(stage));
    }
  });

  it("does not offer Accept at in_progress", () => {
    // The reported case, stated on its own so a regression names itself.
    expect(canApprove("in_progress")).toBe(false);
    expect(canRequestClarification("in_progress")).toBe(false);
    expect(canReject("in_progress")).toBe(false);
  });

  it("offers nothing at all on a settled request", () => {
    for (const stage of ["closed", "rejected", "cancelled"] as RequestStage[]) {
      expect(canApprove(stage)).toBe(false);
      expect(canRequestClarification(stage)).toBe(false);
      expect(canReject(stage)).toBe(false);
      expect(nextStagesFor(stage)).toEqual([]);
    }
  });

  it("still offers the triage actions where triage is the job", () => {
    // Over-hiding would be its own bug: a fresh request must still be
    // acceptable, questionable and rejectable.
    expect(canApprove("submitted")).toBe(true);
    expect(canRequestClarification("submitted")).toBe(true);
    expect(canReject("submitted")).toBe(true);
  });

  it("derives clarification and rejection from the table, not a second list", () => {
    for (const stage of ALL_STAGES) {
      expect(canRequestClarification(stage)).toBe(canTransition(stage, "needs_clarification"));
      expect(canReject(stage)).toBe(canTransition(stage, "rejected"));
    }
  });
});

describe("guidance says what to do instead", () => {
  it("sends an in-progress request with no tasks to the project", () => {
    // What the user actually needed to be told.
    const g = stageGuidance({
      stage: "in_progress",
      hasProject: true,
      projectId: "p1",
      projectCode: "PRJ-2026-0002",
      hasTasks: false,
    });
    expect(g.headline).toMatch(/triage is finished/i);
    expect(g.action).toMatch(/no tasks yet/i);
    expect(g.action).toMatch(/nobody can be assigned/i);
    expect(g.link).toEqual({ href: "/projects/p1", label: "Open PRJ-2026-0002" });
  });

  it("does not claim there are no tasks when there are", () => {
    const g = stageGuidance({
      stage: "in_progress",
      hasProject: true,
      projectId: "p1",
      projectCode: "PRJ-2026-0002",
      hasTasks: true,
    });
    expect(g.action).not.toMatch(/no tasks/i);
    expect(g.action).toMatch(/project/i);
  });

  it("flags the impossible case rather than linking nowhere", () => {
    // in_progress with no project should not happen. Saying so is better than
    // rendering a link to undefined.
    const g = stageGuidance({ stage: "in_progress", hasProject: false });
    expect(g.action).toMatch(/should not happen/i);
    expect(g.link).toBeUndefined();
  });

  it("gives every stage a headline and an action", () => {
    // Exhaustive, so adding a stage to the enum fails here rather than
    // rendering a blank panel.
    for (const stage of ALL_STAGES) {
      const g = stageGuidance({ stage, hasProject: false });
      expect(g.headline.length).toBeGreaterThan(0);
      expect(g.action.length).toBeGreaterThan(0);
    }
  });

  it("tells a settled request there is nothing to do", () => {
    for (const stage of ["closed", "rejected", "cancelled"] as RequestStage[]) {
      expect(stageGuidance({ stage, hasProject: false }).headline).toMatch(/nothing further/i);
    }
  });
});
