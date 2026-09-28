import { Queue } from "bullmq";
import type { Redis } from "ioredis";

/**
 * Background job system (spec §19). Scanning, removal and verification never
 * run inside HTTP requests. BullMQ (Redis) in production; an in-memory queue
 * for tests and single-process development.
 */
export const JobNames = {
  Discovery: "DiscoveryJob",
  Removal: "RemovalJob",
  Verification: "VerificationJob",
  Monitoring: "MonitoringJob",
  Search: "SearchJob",
  Notification: "NotificationJob",
  MonitoringTick: "MonitoringTick",
  WorkflowResumeTick: "WorkflowResumeTick",
  RetentionSweep: "RetentionSweep",
  ProviderHealth: "ProviderHealthJob",
} as const;
export type JobName = (typeof JobNames)[keyof typeof JobNames];

export interface JobPayloads {
  DiscoveryJob: { scanId: string };
  RemovalJob: { requestId: string };
  VerificationJob: { recordId: string; requestId?: string; kind: "POST_SUBMISSION" | "MONITORING" | "DOWNSTREAM" };
  MonitoringJob: { monitoringJobId: string };
  SearchJob: { recordId: string };
  NotificationJob: { notificationId: string };
  MonitoringTick: Record<string, never>;
  WorkflowResumeTick: Record<string, never>;
  RetentionSweep: Record<string, never>;
  ProviderHealthJob: Record<string, never>;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Deduplication key: a job with the same id is not enqueued twice while pending. */
  jobId?: string;
  attempts?: number;
}

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
  close(): Promise<void>;
}

export const QUEUE_NAME = "deepscrubber";

export class BullJobQueue implements JobQueue {
  private readonly queue: Queue;

  constructor(connection: Redis) {
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 14 * 24 * 3600 },
      },
    });
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}): Promise<void> {
    await this.queue.add(name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId?.replace(/:/g, "_"),
      attempts: opts.attempts,
    });
  }

  get raw(): Queue {
    return this.queue;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export interface MemoryJob {
  id: string;
  name: JobName;
  data: unknown;
  runAt: number;
  attempts: number;
  maxAttempts: number;
}

export type JobHandler = (name: JobName, data: unknown, attempt: number) => Promise<void>;

/** In-process queue. `drain()` runs due jobs; tests control time via `now`. */
export class MemoryJobQueue implements JobQueue {
  readonly jobs: MemoryJob[] = [];
  readonly failed: Array<MemoryJob & { error: string }> = [];
  /** Every error thrown by a handler, including ones that will be retried. */
  readonly errors: Array<{ name: JobName; error: string; attempt: number }> = [];
  private seq = 0;
  handler?: JobHandler;

  constructor(private readonly now: () => number = Date.now) {}

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}): Promise<void> {
    if (opts.jobId && this.jobs.some((j) => j.id === opts.jobId)) return;
    this.jobs.push({
      id: opts.jobId ?? `job-${++this.seq}`,
      name,
      data,
      runAt: this.now() + (opts.delayMs ?? 0),
      attempts: 0,
      maxAttempts: opts.attempts ?? 3,
    });
  }

  /** Run every job due at or before `until`; returns the number executed. */
  async drain(until = this.now(), maxJobs = 1000): Promise<number> {
    if (!this.handler) throw new Error("MemoryJobQueue has no handler");
    let ran = 0;
    for (;;) {
      this.jobs.sort((a, b) => a.runAt - b.runAt);
      const idx = this.jobs.findIndex((j) => j.runAt <= until);
      if (idx < 0 || ran >= maxJobs) return ran;
      const job = this.jobs.splice(idx, 1)[0]!;
      job.attempts++;
      ran++;
      try {
        await this.handler(job.name, job.data, job.attempts);
      } catch (err) {
        this.errors.push({ name: job.name, error: err instanceof Error ? err.message : String(err), attempt: job.attempts });
        if (job.attempts < job.maxAttempts) {
          job.runAt = until + 1; // retried on the next drain pass
          this.jobs.push(job);
          if (ran >= maxJobs) return ran;
          continue;
        }
        this.failed.push({ ...job, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  pending(name?: JobName): MemoryJob[] {
    return this.jobs.filter((j) => !name || j.name === name);
  }

  async close(): Promise<void> {}
}
