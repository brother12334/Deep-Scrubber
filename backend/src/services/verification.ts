import { downstreamOf } from "../../../core/dependencies";
import { nextRecheck } from "../../../core/monitoring";
import type { VerificationOutcome } from "../../../shared/domain";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { audit } from "./audit";
import { notifyProfileOwner } from "./notifications";
import { loadSubject, type ProfileRow } from "./profiles";
import { getRecord, setRecordStatus, toAgentRecord } from "./records";
import { agentContextFor, planRemoval, type RequestRow } from "./removals";
import { snapshotScore } from "./scoring";
import { getSource } from "./sources";

/**
 * Verification engine (spec §12) and reappearance detection (spec §13).
 *
 * Every conclusion is recorded as a verification_check with the precise
 * outcome, so "removed from source", "removed from search results" and
 * "no longer detected" are never conflated (spec §42).
 */
const REMOVED_OUTCOMES: VerificationOutcome[] = ["REMOVED_FROM_SOURCE", "REMOVED_FROM_SEARCH_RESULTS", "NO_LONGER_DETECTED"];
const MAX_STILL_PRESENT_CHECKS = 3;
const MAX_INCONCLUSIVE_CHECKS = 5;

export async function verifyRecord(
  ctx: AppContext,
  job: { recordId: string; requestId?: string; kind: "POST_SUBMISSION" | "MONITORING" | "DOWNSTREAM" },
): Promise<VerificationOutcome | "SKIPPED"> {
  const record = await getRecord(ctx, job.recordId);
  if (record.status === "DISMISSED") return "SKIPPED";
  const request = job.requestId ? await ctx.db.one<RequestRow>("SELECT * FROM removal_requests WHERE id = $1", [job.requestId]) : undefined;
  if (job.kind === "POST_SUBMISSION" && request && request.status !== "AWAITING_VERIFICATION") return "SKIPPED";

  const { agent, actx } = await agentContextFor(ctx, record);
  const subject = await loadSubject(ctx, record.profile_id);
  const parentRemoved = record.parent_record_id
    ? (await ctx.db.one<{ status: string }>("SELECT status FROM discovered_records WHERE id = $1", [record.parent_record_id]))?.status === "REMOVED"
    : false;
  const result = await agent.verifyRemoval(actx, toAgentRecord(ctx, record, { originGone: parentRemoved }), subject);
  await ctx.db.query(
    "INSERT INTO verification_checks (record_id, request_id, kind, found, outcome, method, details, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [record.id, request?.id ?? null, job.kind, result.found, result.outcome, result.method, JSON.stringify(result.details), ctx.clock.now()],
  );
  if (request) await ctx.db.query("UPDATE removal_requests SET next_check_at = NULL WHERE id = $1", [request.id]);

  const removed = REMOVED_OUTCOMES.includes(result.outcome);
  const src = record.source_id ? await getSource(ctx, record.source_id) : undefined;
  const name = src?.name ?? record.domain;

  if (job.kind === "MONITORING") {
    if (record.status === "REMOVED" && (result.outcome === "STILL_PRESENT" || result.outcome === "PARTIALLY_REMOVED")) {
      await handleReappearance(ctx, record.id, record.profile_id, name);
    }
    return result.outcome;
  }

  if (removed) {
    await setRecordStatus(ctx, record.id, "REMOVED", outcomeReason(result.outcome), { removedAt: ctx.clock.now(), outcome: result.outcome });
    if (request) {
      await ctx.db.query("UPDATE removal_requests SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1", [request.id]);
    }
    await scheduleRecordMonitoring(ctx, record.profile_id, record.id);
    await audit(ctx, { actorType: "worker", action: "verification.removed", targetType: "record", targetId: record.id, metadata: { outcome: result.outcome, kind: job.kind } });
    await notifyProfileOwner(ctx, record.profile_id, {
      kind: "REMOVED",
      severity: "success",
      title: `${name} — ${result.outcome === "NO_LONGER_DETECTED" ? "no longer detected" : "removed"}`,
      body: outcomeReason(result.outcome),
      link: `/exposures?id=${record.id}`,
    });
    // Dependency graph: verify everything downstream of this record.
    const nodes = await ctx.db.query<{ id: string; parent_record_id: string | null }>(
      "SELECT id, parent_record_id FROM discovered_records WHERE profile_id = $1 AND status NOT IN ('REMOVED','DISMISSED')",
      [record.profile_id],
    );
    for (const id of downstreamOf(record.id, [...nodes.map((n) => ({ id: n.id, parentId: n.parent_record_id })), { id: record.id, parentId: null }])) {
      await ctx.queue.enqueue(JobNames.Verification, { recordId: id, kind: "DOWNSTREAM" }, { jobId: `downstream:${id}:${record.id}` });
    }
    await snapshotScore(ctx, record.profile_id);
    return result.outcome;
  }

  if (job.kind === "DOWNSTREAM") {
    if (result.outcome === "STILL_PRESENT" || result.outcome === "PARTIALLY_REMOVED") {
      // The origin is gone but this copy remains: start its own removal (e.g. outdated-content refresh).
      await planRemoval(ctx, record.id, { force: true });
    } else {
      await setRecordStatus(ctx, record.id, record.status, "We couldn't check this automatically yet; we'll try again.");
      await scheduleRecordMonitoring(ctx, record.profile_id, record.id);
    }
    return result.outcome;
  }

  // POST_SUBMISSION, not removed.
  const checks = await ctx.db.one<{ still: number; inconclusive: number }>(
    `SELECT count(*) FILTER (WHERE outcome IN ('STILL_PRESENT','PARTIALLY_REMOVED'))::int AS still,
            count(*) FILTER (WHERE outcome = 'INCONCLUSIVE')::int AS inconclusive
     FROM verification_checks WHERE request_id = $1`,
    [request?.id ?? null],
  );
  const recheckDays = Math.max(2, Math.ceil((src?.estimatedRemovalTime ?? 7) / 2));
  if (result.outcome === "PARTIALLY_REMOVED") await setRecordStatus(ctx, record.id, "PARTIALLY_REMOVED", "Some details were removed but part of the listing is still visible.");
  if (result.outcome === "INCONCLUSIVE") {
    if ((checks?.inconclusive ?? 0) >= MAX_INCONCLUSIVE_CHECKS) {
      await escalate(ctx, request, record.id, record.profile_id, "We couldn't verify this automatically. Please check the listing yourself.");
    } else await scheduleRecheck(ctx, request, record.id, 1);
    return result.outcome;
  }
  if ((checks?.still ?? 0) >= MAX_STILL_PRESENT_CHECKS) {
    await escalate(ctx, request, record.id, record.profile_id, `${name} still shows the listing after ${checks?.still} checks.`);
  } else {
    await scheduleRecheck(ctx, request, record.id, recheckDays);
    if (result.outcome === "STILL_PRESENT") {
      await setRecordStatus(ctx, record.id, "AWAITING_VERIFICATION", `Still live at the source; providers can take time. Re-checking in ${recheckDays} day(s).`);
    }
  }
  return result.outcome;
}

function outcomeReason(o: VerificationOutcome): string {
  switch (o) {
    case "REMOVED_FROM_SOURCE":
      return "Removed from source: the listing is gone from the website.";
    case "REMOVED_FROM_SEARCH_RESULTS":
      return "Removed from search results. The original page may still exist.";
    case "NO_LONGER_DETECTED":
      return "No longer detected: the page loads but your information no longer appears on it.";
    default:
      return o;
  }
}

async function scheduleRecheck(ctx: AppContext, request: RequestRow | undefined, recordId: string, days: number) {
  if (!request) return;
  const at = new Date(ctx.clock.now().getTime() + days * 86_400_000);
  await ctx.db.query("UPDATE removal_requests SET next_check_at = $2, updated_at = now() WHERE id = $1", [request.id, at]);
  await ctx.queue.enqueue(
    JobNames.Verification,
    { recordId, requestId: request.id, kind: "POST_SUBMISSION" },
    { delayMs: days * 86_400_000, jobId: `verify:${request.id}:${at.getTime()}` },
  );
}

async function escalate(ctx: AppContext, request: RequestRow | undefined, recordId: string, profileId: string, reason: string) {
  if (request) {
    await ctx.db.query("UPDATE removal_requests SET status = 'FAILED', last_error = $2, completed_at = now(), updated_at = now() WHERE id = $1", [request.id, reason]);
  }
  await setRecordStatus(ctx, recordId, "FAILED", reason);
  await notifyProfileOwner(ctx, profileId, { kind: "REQUEST_FAILED", severity: "critical", title: "Removal not confirmed", body: reason, link: `/exposures?id=${recordId}` });
}

async function handleReappearance(ctx: AppContext, recordId: string, profileId: string, name: string) {
  await setRecordStatus(ctx, recordId, "REAPPEARED", "Profile detected again. The source may have regenerated the record.", { removedAt: null });
  await audit(ctx, { actorType: "worker", action: "monitoring.reappeared", targetType: "record", targetId: recordId });
  await notifyProfileOwner(ctx, profileId, {
    kind: "REAPPEARED",
    severity: "critical",
    title: `${name} — reappeared`,
    body: "A previously removed profile was detected again. The source may have regenerated the record.",
    link: `/exposures?id=${recordId}`,
  });
  const profile = await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1", [profileId]);
  // In AUTOMATIC mode with blanket authorization, re-submit; otherwise the user decides.
  if (profile?.default_approval_mode === "AUTOMATIC" && profile.blanket_authorization_at) {
    await planRemoval(ctx, recordId, { force: true });
  }
  await snapshotScore(ctx, profileId);
}

/** Day 1, 3, 7, 14, 30 then every N days after a verified removal. */
export async function scheduleRecordMonitoring(ctx: AppContext, profileId: string, recordId: string) {
  const p = await ctx.db.one<{ monitoring_interval_days: number }>("SELECT monitoring_interval_days FROM privacy_profiles WHERE id = $1", [profileId]);
  const { at } = nextRecheck(ctx.clock.now(), 0, p?.monitoring_interval_days ?? 30);
  await ctx.db.query(
    `INSERT INTO monitoring_jobs (profile_id, record_id, kind, schedule_step, next_run_at, active)
     VALUES ($1, $2, 'RECORD_RECHECK', 1, $3, true)
     ON CONFLICT (record_id) WHERE kind = 'RECORD_RECHECK' DO UPDATE SET schedule_step = 1, next_run_at = EXCLUDED.next_run_at, active = true`,
    [profileId, recordId, at],
  );
}
