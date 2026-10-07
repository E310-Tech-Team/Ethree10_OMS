import type { Queue } from "bullmq";

/**
 * Every recurring job, declared once.
 *
 * Job Schedulers, keyed by `id`. They replaced legacy repeatable jobs
 * (`queue.add(name, data, { repeat })`), which BullMQ v6 removes outright.
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
 * Upserts the Job Schedulers, and removes any scheduler nobody declares.
 *
 * The legacy repeatable jobs these replaced were cleared by the previous
 * release, while still on BullMQ v5 — v6 can neither list nor remove them,
 * which is why that had to ship first. What remains is ordinary upkeep: a
 * schedule deleted from RECURRING_JOBS must stop running, so a scheduler whose
 * id is no longer declared is removed. Declared schedulers are only upserted,
 * so restarting the worker does not disturb a pending run.
 */
export async function scheduleRecurringJobs(
  queues: Record<string, Queue>,
  logger: Logger,
): Promise<{ removed: string[]; scheduled: string[] }> {
  const declared = new Set<string>(RECURRING_JOBS.map((job) => job.id));
  const removed: string[] = [];

  for (const queue of Object.values(queues)) {
    for (const scheduler of await queue.getJobSchedulers()) {
      if (declared.has(scheduler.key)) continue;
      await queue.removeJobScheduler(scheduler.key);
      removed.push(`${queue.name}:${scheduler.key}`);
      logger.warn({ queue: queue.name, key: scheduler.key }, "Removed undeclared job scheduler");
    }
  }

  const scheduled: string[] = [];
  for (const job of RECURRING_JOBS) {
    const queue = queues[job.queue];
    if (!queue) throw new Error(`Recurring job ${job.id} names unknown queue ${job.queue}`);
    await queue.upsertJobScheduler(job.id, { pattern: job.pattern, tz: SCHEDULE_TZ }, { name: job.id, data: {} });
    scheduled.push(job.id);
  }
  logger.info({ scheduled, removed: removed.length }, "Recurring jobs scheduled");
  return { removed, scheduled };
}
