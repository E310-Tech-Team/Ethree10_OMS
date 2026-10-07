import type { Queue } from "bullmq";

/**
 * Every recurring job, declared once.
 *
 * These were legacy repeatable jobs (`queue.add(name, data, { repeat })`),
 * which BullMQ v6 removes outright — the option, and the APIs that list and
 * remove them. They are Job Schedulers now, keyed by `id`.
 *
 * `id` doubles as the job name, because the workers dispatch on `job.name`.
 * Keeping them identical means nothing downstream of the schedule changes.
 */
export const RECURRING_JOBS = [
  // The just-completed Lagos week, after its Sunday cutoff.
  { queue: "reports", id: "weekly-report", pattern: "15 0 * * 1" },
  // The just-completed Lagos month, on the first day of the next.
  { queue: "reports", id: "monthly-report", pattern: "30 0 1 * *" },
  // Flip overdue invoices daily.
  { queue: "reports", id: "mark-overdue-invoices", pattern: "0 6 * * *" },
  // Work due within 48h, and anything already late — before the working day.
  { queue: "reports", id: "task-due-reminders", pattern: "0 7 * * *" },
] as const;

export const SCHEDULE_TZ = "Africa/Lagos";

type Logger = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };

/**
 * Removes legacy repeatable jobs, then upserts the Job Schedulers.
 *
 * BullMQ's v5 → v6 guide is explicit that this has to happen while still on
 * v5: legacy repeatables already stored in Redis cannot be listed or removed
 * from v6, and left in place they keep firing alongside their schedulers — a
 * duplicated weekly report and a second round of reminder emails.
 *
 * In v5 both kinds live in the same Redis set. A scheduler's key is the id we
 * chose; a legacy repeatable's key is a hash of its options. So anything whose
 * key is not one of our scheduler ids is removed — the legacy entries, and any
 * schedule nobody declares any more. Our own schedulers are left untouched, so
 * restarting the worker does not disturb a pending run.
 *
 * Safe to run on every start: once the legacy entries are gone there is
 * nothing to remove, and upserting an unchanged scheduler is a no-op.
 *
 * When BullMQ moves to v6, delete the removal loop — its APIs no longer exist
 * there, and by then there is nothing left for it to find.
 */
export async function scheduleRecurringJobs(
  queues: Record<string, Queue>,
  logger: Logger,
): Promise<{ removedLegacy: string[]; scheduled: string[] }> {
  const declared = new Set<string>(RECURRING_JOBS.map((job) => job.id));
  const removedLegacy: string[] = [];

  for (const queue of Object.values(queues)) {
    for (const repeatable of await queue.getRepeatableJobs()) {
      if (declared.has(repeatable.key)) continue;
      await queue.removeRepeatableByKey(repeatable.key);
      removedLegacy.push(`${queue.name}:${repeatable.name}`);
      logger.warn({ queue: queue.name, name: repeatable.name, key: repeatable.key }, "Removed legacy repeatable job");
    }
  }

  const scheduled: string[] = [];
  for (const job of RECURRING_JOBS) {
    const queue = queues[job.queue];
    if (!queue) throw new Error(`Recurring job ${job.id} names unknown queue ${job.queue}`);
    await queue.upsertJobScheduler(job.id, { pattern: job.pattern, tz: SCHEDULE_TZ }, { name: job.id, data: {} });
    scheduled.push(job.id);
  }
  logger.info({ scheduled, removedLegacy: removedLegacy.length }, "Recurring jobs scheduled");
  return { removedLegacy, scheduled };
}
