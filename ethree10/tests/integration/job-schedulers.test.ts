import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { RECURRING_JOBS, SCHEDULE_TZ, scheduleRecurringJobs } from "@/workers/schedules";

/**
 * The move from legacy repeatable jobs to Job Schedulers, against real Redis.
 *
 * Production Redis holds the four report jobs as legacy repeatables, created by
 * `queue.add(name, data, { repeat })`. BullMQ v6 cannot list or remove those,
 * and left in place they fire alongside the new schedulers. This seeds Redis
 * exactly as production has it, then checks the worker's startup leaves the
 * four schedulers and nothing else — and that a second start changes nothing.
 *
 * Runs only when REDIS_TEST_URL is set, so it can never touch a Redis named in
 * a developer's .env. Everything lives under a unique prefix, removed after.
 */
const url = process.env["REDIS_TEST_URL"];
const prefix = `sched-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const quiet = { info: () => undefined, warn: () => undefined };

describe.skipIf(!url)("recurring jobs as Job Schedulers", () => {
  let queues: Record<string, Queue>;

  beforeAll(async () => {
    const connection = { url: url!, maxRetriesPerRequest: null };
    queues = {
      notifications: new Queue("notifications", { connection, prefix }),
      reports: new Queue("reports", { connection, prefix }),
      integrations: new Queue("integrations", { connection, prefix }),
    };
  });

  afterAll(async () => {
    for (const queue of Object.values(queues ?? {})) {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });

  it("replaces the legacy repeatables production has with schedulers, and nothing else", async () => {
    // As v5 stored them in production — plus one schedule nobody declares any more.
    for (const job of RECURRING_JOBS) {
      await queues[job.queue]!.add(job.id, {}, { repeat: { pattern: job.pattern, tz: SCHEDULE_TZ } });
    }
    await queues["reports"]!.add("retired-job", {}, { repeat: { pattern: "0 3 * * *", tz: SCHEDULE_TZ } });
    expect((await queues["reports"]!.getRepeatableJobs()).length).toBe(RECURRING_JOBS.length + 1);

    const first = await scheduleRecurringJobs(queues, quiet);
    expect(first.removedLegacy).toHaveLength(RECURRING_JOBS.length + 1);

    const schedulers = await queues["reports"]!.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(RECURRING_JOBS.map((j) => j.id).sort());
    for (const job of RECURRING_JOBS) {
      const s = schedulers.find((x) => x.key === job.id)!;
      expect(s.pattern).toBe(job.pattern);
      expect(s.tz).toBe(SCHEDULE_TZ);
    }

    // One pending run per schedule, named as the worker dispatches on — no
    // leftover legacy run waiting to fire alongside it.
    const delayed = await queues["reports"]!.getDelayed();
    expect(delayed.map((j) => j.name).sort()).toEqual(RECURRING_JOBS.map((j) => j.id).sort());
  });

  it("changes nothing when the worker starts again", async () => {
    const before = (await queues["reports"]!.getDelayed()).map((j) => `${j.name}@${j.timestamp + (j.delay ?? 0)}`).sort();
    const again = await scheduleRecurringJobs(queues, quiet);
    expect(again.removedLegacy).toHaveLength(0);
    expect(await queues["reports"]!.getJobSchedulersCount()).toBe(RECURRING_JOBS.length);
    const after = (await queues["reports"]!.getDelayed()).map((j) => `${j.name}@${j.timestamp + (j.delay ?? 0)}`).sort();
    expect(after).toEqual(before);
  });
});
