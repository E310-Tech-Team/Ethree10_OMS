import { z } from "zod";
import { router } from "../trpc";
import { protectedProcedure } from "../procedures";
import { TimeLogService } from "@/server/services/timeLog";
import { assertCanAccessTask, canSeeTeam } from "@/server/auth/visibility";
import { requireAgencyAction } from "@/server/services/agency";
import { db } from "@/server/db/client";
import { TRPCError } from "@trpc/server";

/**
 * Every procedure here shipped with no authorization of any kind.
 *
 * `listForUser` took a userId straight from the caller and returned that
 * person's entire timesheet — what they worked on, for how long, on which days —
 * to anyone holding a session. `listForTask` did the same for any task in the
 * agency, and `add` let anyone log hours against any task, moving its
 * `loggedHours` and with it the project's reported effort.
 *
 * Being signed in was the only check. These are the three that were missing.
 */
export const timeLogsRouter = router({
  listForTask: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      await assertCanAccessTask(ctx.userId, input, "task.read");
      return TimeLogService.listForTask(input);
    }),

  listForUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        fromDate: z.date().optional(),
        toDate: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Your own timesheet is always yours to read, whatever your role — a team
      // member has no reporting permission and still needs to see what they
      // logged.
      if (input.userId !== ctx.userId) {
        // Someone else's is management information, so it takes a reporting
        // permission. `report.read` is held by the leads and above and is
        // deliberately NOT held by team_member: a colleague's hours are not
        // peer-readable. `member.read` would have been the wrong gate — every
        // role has it, so it would have left the hole open.
        await requireAgencyAction(ctx.userId, "report.read");

        // And only for people in your own branches. A branch head holds
        // report.read for their branch, not for the agency.
        const target = await db.membership.findFirst({
          where: { userId: input.userId, removedAt: null, acceptedAt: { not: null } },
          select: { teamId: true },
        });
        if (!target || !(await canSeeTeam(ctx.userId, target.teamId))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
        }
      }
      return TimeLogService.listForUser(input.userId, input.fromDate, input.toDate);
    }),

  add: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        hours: z.number().positive(),
        note: z.string().optional(),
        date: z.date(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Logging time changes the task's loggedHours, so it is a write on the
      // task and takes task.update on a task the caller can actually see.
      // The actor is still forced to ctx.userId below — nobody logs time as
      // somebody else.
      await assertCanAccessTask(ctx.userId, input.taskId, "task.update");
      return TimeLogService.addTimeLog({
        actorId: ctx.userId,
        taskId: input.taskId,
        hours: input.hours,
        note: input.note,
        date: input.date,
      });
    }),
});
