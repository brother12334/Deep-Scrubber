import { Worker } from "bullmq";
import { closeContext, createContext } from "../../backend/src/context";
import { BullJobQueue, JobNames, QUEUE_NAME, type JobName } from "../../backend/src/infra/queue";
import { createJobHandler } from "./handlers";

/**
 * Background worker process. Runs discovery, removal, verification,
 * monitoring, notification, retention and provider-health jobs, plus the
 * repeatable schedulers that drive continuous monitoring.
 */
const ctx = createContext();
const handle = createJobHandler(ctx);
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => handle(job.name as JobName, job.data),
  { connection: ctx.redis!, concurrency },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1);
  ctx.log.warn({ job: job.name, id: job.id, attempt: job.attemptsMade, final, err: err.message }, "job failed");
  if (final) {
    // Only opaque ids go into failed_jobs — never payload contents that could contain PII.
    const ref = Object.fromEntries(Object.entries(job.data ?? {}).filter(([k]) => /Id$/.test(k)));
    await ctx.db
      .query("INSERT INTO failed_jobs (queue, job_name, job_id, error, attempts, payload_ref) VALUES ($1, $2, $3, $4, $5, $6)", [
        QUEUE_NAME,
        job.name,
        job.id ?? null,
        err.message.slice(0, 1000),
        job.attemptsMade,
        JSON.stringify(ref),
      ])
      .catch(() => undefined);
  }
});

async function registerSchedulers() {
  const q = (ctx.queue as BullJobQueue).raw;
  await q.upsertJobScheduler("monitoring-tick", { every: 60_000 }, { name: JobNames.MonitoringTick, data: {} });
  await q.upsertJobScheduler("retention-sweep", { every: 3600_000 }, { name: JobNames.RetentionSweep, data: {} });
  await q.upsertJobScheduler("provider-health", { every: 15 * 60_000 }, { name: JobNames.ProviderHealth, data: {} });
}

registerSchedulers()
  .then(() => ctx.log.info({ concurrency }, "worker started"))
  .catch((err) => {
    ctx.log.error({ err: String(err) }, "failed to register schedulers");
    process.exit(1);
  });

async function shutdown(signal: string) {
  ctx.log.info({ signal }, "worker shutting down");
  await worker.close();
  await closeContext(ctx);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
