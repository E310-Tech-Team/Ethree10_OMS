import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { getAgencyAuthContext, requireAgencyAction } from "@/server/services/agency";
import { hasAgencyWideScope } from "@/server/auth/role-groups";
import type { Action } from "@/server/auth/permissions";

/**
 * Which branches a user may see, and the record-level checks built on it.
 *
 * `visibleTeamIds` lived inside routers/requests.ts, so it guarded exactly one
 * router. Every other router that needed the same rule either re-derived it or,
 * more often, did without — timeLogs and attachments.list shipped with no check
 * at all, and `timeLogs.listForUser({ userId })` returned any colleague's whole
 * timesheet to anyone signed in.
 *
 * Two rules, deliberately separate:
 *
 *   - Does this role hold the action at all? (`requireAgencyAction`)
 *   - Is this particular record inside the caller's branches?
 *
 * Holding `task.read` is not permission to read *every* task; a branch head
 * holds it for their own branch. A check that asks only the first question
 * looks like authorization and is not.
 */

/** Branches the user can see, or `null` meaning "the whole agency". */
export async function visibleTeamIds(userId: string): Promise<string[] | null> {
  const auth = await getAgencyAuthContext(userId);
  if (hasAgencyWideScope(auth)) return null;
  const memberships = await db.membership.findMany({
    where: { userId, removedAt: null, acceptedAt: { not: null }, teamId: { not: null } },
    select: { teamId: true },
  });
  return memberships.flatMap((membership) => (membership.teamId ? [membership.teamId] : []));
}

/**
 * True when `teamId` is inside the caller's scope.
 *
 * A record with NO branch is visible to anyone holding the action. This is the
 * part worth being explicit about: the check exists to stop one branch reaching
 * into another's work, and a record that belongs to no branch cannot belong to
 * another one. Work sits unrouted or unassigned during intake — a request
 * before triage, a project before it is given to a branch — and treating that
 * as "everyone is excluded" locks everyone out of normal early-stage work
 * rather than protecting anything.
 *
 * Note this is deliberately *not* the same rule as the requests list, which
 * filters unrouted requests out with `routedTeamId: { in: teamIds }`. That is a
 * list asking "what should I show you", and unrouted work is noise there. This
 * is an access check asking "may you touch this one", and they are different
 * questions with different right answers.
 */
export async function canSeeTeam(userId: string, teamId: string | null): Promise<boolean> {
  const scope = await visibleTeamIds(userId);
  if (scope === null) return true;
  if (!teamId) return true;
  return scope.includes(teamId);
}

/**
 * NOT_FOUND rather than FORBIDDEN, on purpose.
 *
 * FORBIDDEN on a record outside your branch confirms the record exists, which
 * turns a list nobody may read into one anybody may enumerate by id. The caller
 * cannot see it, so as far as they are concerned it is not there.
 */
function notFound(what: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${what} not found.` });
}

/**
 * The caller holds `action` AND the task is in one of their branches.
 * A task reaches a branch through its project.
 */
export async function assertCanAccessTask(
  userId: string,
  taskId: string,
  action: Action = "task.read",
): Promise<void> {
  await requireAgencyAction(userId, action);
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { agencyTeamId: true } } },
  });
  if (!task) notFound("Task");
  if (!(await canSeeTeam(userId, task.project.agencyTeamId))) notFound("Task");
}

/** The caller holds `action` AND the request is routed to one of their branches. */
export async function assertCanAccessRequest(
  userId: string,
  requestId: string,
  action: Action = "request.read",
): Promise<void> {
  await requireAgencyAction(userId, action);
  const request = await db.request.findUnique({
    where: { id: requestId },
    select: { routedTeamId: true },
  });
  if (!request) notFound("Request");
  if (!(await canSeeTeam(userId, request.routedTeamId))) notFound("Request");
}
