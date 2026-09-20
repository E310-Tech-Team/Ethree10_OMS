import type { RequestStage } from "@prisma/client";

/**
 * Which stage a request may move to, and what someone should do next.
 *
 * This table existed twice: once in `server/services/request.ts` as the guard,
 * and once in the request detail page as a hand-copied constant commented
 * "mirrors the server-side guard". Two copies of one rule is the drift pattern
 * this codebase already learned about with role arrays — they agreed on the day
 * they were written and nothing kept them agreeing.
 *
 * Pure data with no database import, so the server guard and the screen can
 * share it.
 */
export const ALLOWED_TRANSITIONS: Record<RequestStage, RequestStage[]> = {
  submitted: ["under_review", "needs_clarification", "rejected", "cancelled", "pending_approval"],
  needs_clarification: ["under_review", "rejected", "cancelled"],
  pending_approval: ["under_review", "scoping", "rejected", "cancelled"],
  under_review: ["scoping", "rejected", "on_hold", "cancelled"],
  scoping: ["proposal", "approved", "on_hold", "cancelled", "pending_approval"],
  proposal: ["approved", "rejected", "on_hold", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["in_review", "on_hold", "cancelled"],
  in_review: ["delivered", "in_progress"],
  delivered: ["closed", "in_review"],
  closed: [],
  rejected: [],
  on_hold: ["under_review", "scoping", "in_progress", "cancelled"],
  cancelled: [],
};

/**
 * Stages `RequestService.approve` accepts.
 *
 * Deliberately NOT derived from the table above. Accepting is its own operation
 * — it also creates the project — and its guard is a separate list in the
 * service. Mirroring it here would reintroduce exactly the duplication this
 * file exists to remove, so the list is stated once and asserted against the
 * service in `tests/unit/request-stages.test.ts`.
 */
export const APPROVABLE_FROM: RequestStage[] = [
  "submitted",
  "under_review",
  "scoping",
  "proposal",
  "pending_approval",
];

export function nextStagesFor(stage: RequestStage): RequestStage[] {
  return ALLOWED_TRANSITIONS[stage] ?? [];
}

export function canTransition(from: RequestStage, to: RequestStage): boolean {
  return nextStagesFor(from).includes(to);
}

/** Can this request be accepted — the action that also creates its project? */
export function canApprove(stage: RequestStage): boolean {
  return APPROVABLE_FROM.includes(stage);
}

/** Can the team ask the client for more detail from here? */
export function canRequestClarification(stage: RequestStage): boolean {
  return canTransition(stage, "needs_clarification");
}

/** Can it be rejected from here? */
export function canReject(stage: RequestStage): boolean {
  return canTransition(stage, "rejected");
}

/** Stages where nobody is waiting on the agency. */
export const SETTLED_STAGES: RequestStage[] = ["delivered", "closed", "rejected", "cancelled"];

export type StageGuidance = {
  /** What is actually true right now. */
  headline: string;
  /** The next thing a person should do, phrased as that action. */
  action: string;
  /** Where to do it, when the answer is another page. */
  link?: { href: string; label: string };
};

/**
 * What to do next, for a request at this stage.
 *
 * Written because the triage panel offered Accept, Request clarification and
 * Reject at every stage, so a request already being delivered showed three
 * prominent buttons, all three of which the server refuses. Someone trying to
 * move the work forward clicks the obvious one, gets "Request cannot be
 * accepted from in_progress", and has no way to learn that the real next step
 * is on the project rather than here.
 *
 * Hiding the dead buttons stops the wrong action. This says the right one.
 */
export function stageGuidance(args: {
  stage: RequestStage;
  hasProject: boolean;
  projectId?: string | null;
  projectCode?: string | null;
  hasTasks?: boolean;
}): StageGuidance {
  const { stage, hasProject, projectId, projectCode, hasTasks } = args;
  const toProject = hasProject && projectId
    ? { href: `/projects/${projectId}`, label: `Open ${projectCode ?? "the project"}` }
    : undefined;

  switch (stage) {
    case "submitted":
      return {
        headline: "Nobody has picked this up yet.",
        action: "Route it to a branch, then accept it or ask the client for more detail.",
      };
    case "needs_clarification":
      return {
        headline: "Waiting on the client to answer.",
        action: "When they reply, move it to Under review.",
      };
    case "pending_approval":
      return { headline: "Waiting for sign-off.", action: "An approver moves it to Under review or Scoping." };
    case "under_review":
      return { headline: "The team is assessing it.", action: "Move it to Scoping once the work is understood." };
    case "scoping":
      return { headline: "Scope is being worked out.", action: "Draft a proposal, or accept it to create the project." };
    case "proposal":
      return { headline: "A proposal is with the client.", action: "Accept the request once they agree." };
    case "approved":
      return {
        headline: hasProject ? "Accepted — the project exists." : "Accepted.",
        action: hasProject
          ? "Add tasks to the project, then move this to In progress."
          : "The project is created on acceptance; if none exists, raise it with an admin.",
        link: toProject,
      };
    case "in_progress":
      // The case that prompted all of this.
      return {
        headline: "This is being delivered. Triage is finished.",
        action: hasProject
          ? hasTasks === false
            ? "There are no tasks yet, so nobody can be assigned. Add tasks to the project."
            : "Work happens on the project. Come back here only to move it to In review."
          : "No project exists, which should not happen at this stage. Raise it with an admin.",
        link: toProject,
      };
    case "in_review":
      return { headline: "Delivered work is being reviewed.", action: "Mark it Delivered once the review passes.", link: toProject };
    case "delivered":
      return { headline: "Delivered to the client.", action: "Close it once the client accepts.", link: toProject };
    case "on_hold":
      return { headline: "Paused.", action: "Resume it to Under review, Scoping or In progress." };
    case "closed":
      return { headline: "Closed. Nothing further to do.", action: "This request is finished.", link: toProject };
    case "rejected":
      return { headline: "Rejected. Nothing further to do.", action: "This request will not be worked on." };
    case "cancelled":
      return { headline: "Cancelled. Nothing further to do.", action: "This request will not be worked on." };
  }
}
