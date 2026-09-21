import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";

/**
 * `department_lead` is NOT a superset of `team_member`, and that is load-bearing.
 *
 * A lead who also delivers work needs both memberships, because two actions
 * live only on `team_member`:
 *
 *   task.submitCompletion — finishing a task you were assigned
 *   request.create        — raising a request
 *
 * This came up as "samuelilelakinwa has two memberships in the same branch,
 * probably wants collapsing to one". Collapsing to `department_lead` would
 * have removed his ability to submit completion on the very task he had just
 * been assigned — turning a tidy-up into a broken delivery flow.
 *
 * If the model ever changes so that leads can complete their own work, this
 * test fails and the duplicate membership becomes genuinely redundant. Until
 * then it is the mechanism, not a mistake.
 */
describe("lead roles do not subsume team_member", () => {
  const lead = new Set(ROLE_PERMISSIONS.department_lead);
  const member = new Set(ROLE_PERMISSIONS.team_member);
  const branchHead = new Set(ROLE_PERMISSIONS.branch_head);

  it("department_lead cannot submit task completion", () => {
    expect(member.has("task.submitCompletion")).toBe(true);
    expect(lead.has("task.submitCompletion")).toBe(false);
  });

  it("branch_head cannot either", () => {
    // So the same reasoning applies one level up.
    expect(branchHead.has("task.submitCompletion")).toBe(false);
  });

  it("names exactly what a lead would lose by dropping the member role", () => {
    const lost = [...member].filter((action) => !lead.has(action)).sort();
    expect(lost).toEqual(["request.create", "task.submitCompletion"]);
  });

  it("a lead otherwise holds everything a member does", () => {
    // The overlap is large, which is why the gap is easy to miss.
    const shared = [...member].filter((action) => lead.has(action));
    expect(shared.length).toBe(member.size - 2);
  });
});
