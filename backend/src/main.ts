import { createJobHandler } from "../../workers/src/handlers";
import { closeContext, createContext } from "./context";
import { buildApp } from "./http/app";
import { JobNames, MemoryJobQueue } from "./infra/queue";

const ctx = createContext();

/**
 * Single-process mode (QUEUE_DRIVER=memory): the API also runs background jobs
 * in-process, so a personal install needs no Redis and no separate worker.
 * Queued jobs live in memory; if the process restarts, the monitoring tick's
 * safety net re-schedules overdue verifications from the database.
 */
function startInProcessWorker(): () => void {
  const queue = ctx.queue as MemoryJobQueue;
  const handle = createJobHandler(ctx);
  queue.handler = (name, data) => handle(name, data);
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      await queue.drain();
    } catch (err) {
      ctx.log.error({ err: String(err) }, "in-process job runner failed");
    } finally {
      draining = false;
    }
  };
  const every = (ms: number, fn: () => Promise<void> | void) => setInterval(() => void fn(), ms);
  const timers = [
    every(1_000, drain),
    every(60_000, () => ctx.queue.enqueue(JobNames.MonitoringTick, {})),
    every(15 * 60_000, () => ctx.queue.enqueue(JobNames.ProviderHealth, {})),
    every(3_600_000, () => ctx.queue.enqueue(JobNames.RetentionSweep, {})),
  ];
  void ctx.queue.enqueue(JobNames.MonitoringTick, {});
  ctx.log.info("single-process mode: background jobs run inside the API (no Redis needed)");
  return () => timers.forEach(clearInterval);
}

buildApp(ctx)
  .then(async (app) => {
    const stopWorker = ctx.queue instanceof MemoryJobQueue ? startInProcessWorker() : () => {};
    await app.listen({ host: ctx.cfg.API_HOST, port: ctx.cfg.API_PORT });
    ctx.log.info({ port: ctx.cfg.API_PORT }, "API listening");
    const shutdown = async (signal: string) => {
      ctx.log.info({ signal }, "API shutting down");
      stopWorker();
      await app.close();
      await closeContext(ctx);
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
  })
  .catch((err) => {
    ctx.log.error({ err: String(err) }, "failed to start API");
    process.exit(1);
  });
