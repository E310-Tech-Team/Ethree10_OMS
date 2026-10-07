import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { RECURRING_JOBS, SCHEDULE_TZ, scheduleRecurringJobs } from "@/workers/schedules";

/**
 * The recurring jobs as Job Schedulers, against real Redis: the worker's
 * start-up leaves exactly the declared schedulers, each with one pending run,
 * removes any scheduler nobody declares, and a second start changes nothing.
 * (The move off legacy repeatables happened in the release before BullMQ 6,
 * whose version of this test seeded them as production had them.)
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

  it("keeps the declared schedulers and removes a retired one", async () => {
    // Legacy repeatables cannot exist on v6 — the previous release cleared them
    // while still on v5. What v6 has to do is keep the schedule current: a
    // scheduler for a job nobody declares any more must stop running.
    await queues["reports"]!.upsertJobScheduler("retired-job", { pattern: "0 3 * * *", tz: SCHEDULE_TZ }, { name: "retired-job" });

    const first = await scheduleRecurringJobs(queues, quiet);
    expect(first.removed).toEqual(["reports:retired-job"]);

    const schedulers = await queues["reports"]!.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(RECURRING_JOBS.map((j) => j.id).sort());
    for (const job of RECURRING_JOBS) {
      const s = schedulers.find((x) => x.key === job.id)!;
      expect(s.pattern).toBe(job.pattern);
      expect(s.tz).toBe(SCHEDULE_TZ);
    }

    // One pending run per schedule, named as the worker dispatches on.
    const delayed = await queues["reports"]!.getDelayed();
    expect(delayed.map((j) => j.name).sort()).toEqual(RECURRING_JOBS.map((j) => j.id).sort());
  });

  it("changes nothing when the worker starts again", async () => {
    const before = (await queues["reports"]!.getDelayed()).map((j) => `${j.name}@${j.timestamp + (j.delay ?? 0)}`).sort();
    const again = await scheduleRecurringJobs(queues, quiet);
    expect(again.removed).toHaveLength(0);
    expect(await queues["reports"]!.getJobSchedulersCount()).toBe(RECURRING_JOBS.length);
    const after = (await queues["reports"]!.getDelayed()).map((j) => `${j.name}@${j.timestamp + (j.delay ?? 0)}`).sort();
    expect(after).toEqual(before);
  });
});
