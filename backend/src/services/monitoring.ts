import { nextRecheck } from "../../../core/monitoring";
import { badRequest, notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { enqueueScan } from "./scans";
import { verifyRecord } from "./verification";

/** Keep one periodic re-scan per profile (continuous discovery of new exposure). */
export async function ensureProfileRescan(ctx: AppContext, profileId: string): Promise<void> {
  const p = await ctx.db.one<{ monitoring_interval_days: number; monitoring_enabled: boolean }>(
    "SELECT monitoring_interval_days, monitoring_enabled FROM privacy_profiles WHERE id = $1",
    [profileId],
  );
  if (!p) return;
  const next = new Date(ctx.clock.now().getTime() + p.monitoring_interval_days * 86_400_000);
  await ctx.db.query(
    `INSERT INTO monitoring_jobs (profile_id, kind, interval_days, next_run_at, active)
     VALUES ($1, 'PROFILE_RESCAN', $2, $3, $4)
     ON CONFLICT (profile_id) WHERE kind = 'PROFILE_RESCAN'
     DO UPDATE SET interval_days = EXCLUDED.interval_days, active = EXCLUDED.active,
       next_run_at = LEAST(monitoring_jobs.next_run_at, EXCLUDED.next_run_at)`,
    [profileId, p.monitoring_interval_days, next, p.monitoring_enabled],
  );
}

/** MonitoringTick: enqueue due monitoring jobs and resume waiting workflows. */
export async function monitoringTick(ctx: AppContext): Promise<{ monitoring: number; workflows: number; verifications: number }> {
  const now = ctx.clock.now();
  const lease = new Date(now.getTime() + 3600_000);
  const due = await ctx.db.query<{ id: string }>(
    `UPDATE monitoring_jobs SET next_run_at = $2
     WHERE id IN (SELECT id FROM monitoring_jobs WHERE active AND next_run_at <= $1 ORDER BY next_run_at LIMIT 500 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
    [now, lease],
  );
  for (const j of due) await ctx.queue.enqueue(JobNames.Monitoring, { monitoringJobId: j.id }, { jobId: `mon:${j.id}:${now.getTime()}` });

  const waiting = await ctx.db.query<{ request_id: string; id: string }>(
    `UPDATE removal_workflows SET state = 'PENDING', resume_at = NULL
     WHERE state = 'WAITING' AND resume_at <= $1 RETURNING request_id, id`,
    [now],
  );
  for (const w of waiting) await ctx.queue.enqueue(JobNames.Removal, { requestId: w.request_id }, { jobId: `resume:${w.id}:${now.getTime()}` });

  // Safety net for verification jobs lost from the queue.
  const overdue = await ctx.db.query<{ id: string; record_id: string }>(
    `UPDATE removal_requests SET next_check_at = $2
     WHERE status = 'AWAITING_VERIFICATION' AND next_check_at <= $1 - interval '1 hour' RETURNING id, record_id`,
    [now, lease],
  );
  for (const r of overdue) {
    await ctx.queue.enqueue(JobNames.Verification, { recordId: r.record_id, requestId: r.id, kind: "POST_SUBMISSION" }, { jobId: `verify-safety:${r.id}:${now.getTime()}` });
  }
  return { monitoring: due.length, workflows: waiting.length, verifications: overdue.length };
}

/** MonitoringJob. */
export async function runMonitoringJob(ctx: AppContext, id: string): Promise<void> {
  const job = await ctx.db.one<{
    id: string;
    profile_id: string;
    record_id: string | null;
    kind: "RECORD_RECHECK" | "PROFILE_RESCAN";
    schedule_step: number;
    interval_days: number | null;
    active: boolean;
  }>("SELECT * FROM monitoring_jobs WHERE id = $1", [id]);
  if (!job || !job.active) return;
  const p = await ctx.db.one<{ monitoring_interval_days: number; monitoring_enabled: boolean }>(
    "SELECT monitoring_interval_days, monitoring_enabled FROM privacy_profiles WHERE id = $1",
    [job.profile_id],
  );
  if (!p) return;
  const now = ctx.clock.now();
  if (job.kind === "RECORD_RECHECK" && job.record_id) {
    const rec = await ctx.db.one<{ status: string }>("SELECT status FROM discovered_records WHERE id = $1", [job.record_id]);
    if (!rec || rec.status === "DISMISSED") {
      await ctx.db.query("UPDATE monitoring_jobs SET active = false WHERE id = $1", [id]);
      return;
    }
    if (rec.status === "REMOVED") await verifyRecord(ctx, { recordId: job.record_id, kind: "MONITORING" });
    const next = nextRecheck(now, job.schedule_step, p.monitoring_interval_days);
    await ctx.db.query("UPDATE monitoring_jobs SET schedule_step = $2, next_run_at = $3, last_run_at = $4 WHERE id = $1", [id, next.step, next.at, now]);
    return;
  }
  if (job.kind === "PROFILE_RESCAN") {
    if (p.monitoring_enabled) await enqueueScan(ctx, job.profile_id, "MONITORING");
    const next = new Date(now.getTime() + p.monitoring_interval_days * 86_400_000);
    await ctx.db.query("UPDATE monitoring_jobs SET next_run_at = $2, last_run_at = $3, interval_days = $4 WHERE id = $1", [id, next, now, p.monitoring_interval_days]);
  }
}

export async function listMonitoring(ctx: AppContext, profileId: string) {
  return ctx.db.query(
    `SELECT m.id, m.kind, m.record_id, m.schedule_step, m.interval_days, m.next_run_at, m.last_run_at, m.active,
            d.domain, s.name AS source_name, d.status AS record_status
     FROM monitoring_jobs m LEFT JOIN discovered_records d ON d.id = m.record_id LEFT JOIN data_sources s ON s.id = d.source_id
     WHERE m.profile_id = $1 ORDER BY m.next_run_at`,
    [profileId],
  );
}

export async function addRecordMonitor(ctx: AppContext, profileId: string, recordId: string) {
  const rec = await ctx.db.one("SELECT 1 FROM discovered_records WHERE id = $1 AND profile_id = $2", [recordId, profileId]);
  if (!rec) throw notFound("Exposure");
  const { at } = nextRecheck(ctx.clock.now(), 0);
  await ctx.db.query(
    `INSERT INTO monitoring_jobs (profile_id, record_id, kind, schedule_step, next_run_at) VALUES ($1, $2, 'RECORD_RECHECK', 1, $3)
     ON CONFLICT (record_id) WHERE kind = 'RECORD_RECHECK' DO UPDATE SET active = true`,
    [profileId, recordId, at],
  );
}

export async function deleteMonitor(ctx: AppContext, profileId: string, id: string) {
  const row = await ctx.db.one("UPDATE monitoring_jobs SET active = false WHERE id = $1 AND profile_id = $2 RETURNING id", [id, profileId]);
  if (!row) throw notFound("Monitoring job");
}

export function validateInterval(days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 180) throw badRequest("Interval must be 1–180 days.");
}
