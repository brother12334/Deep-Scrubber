import { proposeWorkflowUpdate } from "../../../ai/workflow-assist";
import { computeReliability } from "../../../core/reliability";
import { evaluateHealth } from "../../../core/reliability";
import { DataSourceSchema } from "../../../providers/registry/types";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "../../../removal-agents/engine/definition";
import { safeFetch } from "../../../security/ssrf";
import { badRequest, notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { audit } from "./audit";
import { allSources, invalidateRegistryCache, sourceReliability } from "./sources";

/**
 * Administrator operations (spec §27). Admin views are aggregate or
 * operational: they expose ids, statuses and error codes — never decrypted
 * identifiers, listing URLs or request bodies.
 */
export async function systemMetrics(ctx: AppContext) {
  const m = await ctx.db.one<Record<string, number>>(`SELECT
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM privacy_profiles)::int AS profiles,
      (SELECT count(*) FROM privacy_profiles WHERE flagged_for_review)::int AS flagged_profiles,
      (SELECT count(*) FROM scans WHERE created_at > now() - interval '24 hours')::int AS scans_24h,
      (SELECT count(*) FROM discovered_records)::int AS records,
      (SELECT count(*) FROM discovered_records WHERE status = 'REMOVED')::int AS removed,
      (SELECT count(*) FROM discovered_records WHERE status = 'REAPPEARED')::int AS reappeared,
      (SELECT count(*) FROM removal_requests WHERE status IN ('APPROVED','IN_PROGRESS'))::int AS removals_in_flight,
      (SELECT count(*) FROM removal_requests WHERE status = 'REQUIRES_USER_ACTION')::int AS removals_waiting_on_users,
      (SELECT count(*) FROM removal_requests WHERE status = 'FAILED' AND updated_at > now() - interval '7 days')::int AS removals_failed_7d,
      (SELECT count(*) FROM failed_jobs WHERE NOT resolved)::int AS unresolved_failed_jobs,
      (SELECT count(*) FROM abuse_reports WHERE status IN ('OPEN','INVESTIGATING'))::int AS open_abuse_reports,
      (SELECT count(*) FROM data_sources WHERE automation_paused)::int AS paused_providers`);
  const outcomes = await ctx.db.query<{ outcome: string; n: number }>(
    "SELECT outcome, count(*)::int AS n FROM verification_checks WHERE checked_at > now() - interval '30 days' GROUP BY outcome",
  );
  return { ...m, verificationOutcomes30d: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])) };
}

export async function providersOverview(ctx: AppContext) {
  const sources = await allSources(ctx);
  const rel = await sourceReliability(ctx);
  const health = await ctx.db.query<{ source_id: string; succeeded: number; failed: number }>(
    `SELECT source_id, count(*) FILTER (WHERE kind = 'RUN_SUCCEEDED')::int AS succeeded, count(*) FILTER (WHERE kind = 'RUN_FAILED')::int AS failed
     FROM provider_health_events WHERE created_at > now() - interval '7 days' GROUP BY source_id`,
  );
  const versions = await ctx.db.query<{ source_id: string; version: number; status: string }>(
    "SELECT source_id, version, status FROM provider_configs WHERE status = 'ACTIVE'",
  );
  return sources.map((s) => {
    const h = health.find((x) => x.source_id === s.id) ?? { succeeded: 0, failed: 0 };
    return {
      ...s,
      activeWorkflowVersion: versions.find((v) => v.source_id === s.id)?.version ?? null,
      health: evaluateHealth(h, ctx.cfg.PROVIDER_FAILURE_THRESHOLD, ctx.cfg.PROVIDER_MIN_SAMPLES),
      reliability: rel.get(s.id) ?? computeReliability({ completed: 0, removed: 0, failed: 0, reappeared: 0, avgRemovalDays: null }),
    };
  });
}

export async function upsertProvider(ctx: AppContext, adminId: string, body: unknown) {
  const s = DataSourceSchema.parse(body);
  await ctx.db.query(
    `INSERT INTO data_sources (id, name, domain, categories, discovery_methods, removal_methods, requires_user_verification,
       requires_email_verification, requires_identity_verification, estimated_removal_days, reappears_frequently, supported_regions,
       automation_status, agent_key, opt_out_url, privacy_contact_email, parent_source_id, notes, last_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, domain = EXCLUDED.domain, categories = EXCLUDED.categories,
       discovery_methods = EXCLUDED.discovery_methods, removal_methods = EXCLUDED.removal_methods,
       requires_user_verification = EXCLUDED.requires_user_verification, requires_email_verification = EXCLUDED.requires_email_verification,
       requires_identity_verification = EXCLUDED.requires_identity_verification, estimated_removal_days = EXCLUDED.estimated_removal_days,
       reappears_frequently = EXCLUDED.reappears_frequently, supported_regions = EXCLUDED.supported_regions,
       automation_status = EXCLUDED.automation_status, agent_key = EXCLUDED.agent_key, opt_out_url = EXCLUDED.opt_out_url,
       privacy_contact_email = EXCLUDED.privacy_contact_email, parent_source_id = EXCLUDED.parent_source_id, notes = EXCLUDED.notes,
       last_verified_at = now(), updated_at = now()`,
    [
      s.id, s.name, s.domain, s.categories, s.discoveryMethods, s.removalMethods, s.requiresUserVerification, s.requiresEmailVerification,
      s.requiresIdentityVerification, s.estimatedRemovalTime, s.reappearsFrequently, s.supportedRegions, s.automationStatus, s.agent,
      s.optOutUrl ?? null, s.privacyContactEmail ?? null, s.parentSourceId ?? null, s.notes ?? null,
    ],
  );
  invalidateRegistryCache();
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "provider.upserted", targetType: "data_source", targetId: s.id });
  return s;
}

export async function setProviderEnabled(ctx: AppContext, adminId: string, id: string, enabled: boolean) {
  const row = await ctx.db.one("UPDATE data_sources SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING id", [id, enabled]);
  if (!row) throw notFound("Provider");
  invalidateRegistryCache();
  await audit(ctx, { actorId: adminId, actorType: "admin", action: enabled ? "provider.enabled" : "provider.disabled", targetType: "data_source", targetId: id });
}

export async function listWorkflowVersions(ctx: AppContext, sourceId: string) {
  return ctx.db.query(
    "SELECT id, version, status, definition, changelog, created_at, activated_at FROM provider_configs WHERE source_id = $1 ORDER BY version DESC",
    [sourceId],
  );
}

export async function createWorkflowVersion(ctx: AppContext, adminId: string, sourceId: string, definition: unknown, changelog: string) {
  const parsed = WorkflowDefinitionSchema.parse(definition);
  if (parsed.source !== sourceId) throw badRequest("Workflow source does not match provider.");
  const max = await ctx.db.one<{ v: number | null }>("SELECT max(version) AS v FROM provider_configs WHERE source_id = $1", [sourceId]);
  const version = (max?.v ?? 0) + 1;
  const row = await ctx.db.one<{ id: string }>(
    "INSERT INTO provider_configs (source_id, version, status, definition, changelog, created_by) VALUES ($1, $2, 'DRAFT', $3, $4, $5) RETURNING id",
    [sourceId, version, JSON.stringify({ ...parsed, version }), changelog.slice(0, 2000), adminId],
  );
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "workflow.draft_created", targetType: "provider_config", targetId: row!.id, metadata: { sourceId, version } });
  return { id: row!.id, version };
}

export async function activateWorkflowVersion(ctx: AppContext, adminId: string, sourceId: string, version: number) {
  await ctx.db.tx(async (c) => {
    const target = await c.query("SELECT id FROM provider_configs WHERE source_id = $1 AND version = $2", [sourceId, version]);
    if (!target.rowCount) throw notFound("Workflow version");
    await c.query("UPDATE provider_configs SET status = 'RETIRED' WHERE source_id = $1 AND status = 'ACTIVE'", [sourceId]);
    await c.query("UPDATE provider_configs SET status = 'ACTIVE', activated_at = now() WHERE source_id = $1 AND version = $2", [sourceId, version]);
  });
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "workflow.activated", targetType: "data_source", targetId: sourceId, metadata: { version } });
}

export async function disableWorkflowVersion(ctx: AppContext, adminId: string, sourceId: string, version: number) {
  const row = await ctx.db.one("UPDATE provider_configs SET status = 'DISABLED' WHERE source_id = $1 AND version = $2 RETURNING id", [sourceId, version]);
  if (!row) throw notFound("Workflow version");
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "workflow.disabled", targetType: "data_source", targetId: sourceId, metadata: { version } });
}

/** AI-assisted maintenance: fetch the provider's public opt-out page and propose a DRAFT update. */
export async function proposeWorkflowFix(ctx: AppContext, adminId: string, sourceId: string, note: string) {
  const current = await ctx.db.one<{ definition: WorkflowDefinition }>(
    "SELECT definition FROM provider_configs WHERE source_id = $1 AND status IN ('ACTIVE','DISABLED') ORDER BY version DESC LIMIT 1",
    [sourceId],
  );
  const src = (await allSources(ctx)).find((s) => s.id === sourceId);
  if (!current || !src) throw notFound("Workflow");
  if (!src.optOutUrl) throw badRequest("Provider has no opt-out URL to inspect.");
  const page = await safeFetch(src.optOutUrl, {}, ctx.fetchPolicy);
  const proposal = await proposeWorkflowUpdate(ctx.llm, WorkflowDefinitionSchema.parse(current.definition), page.body, note);
  if (!proposal) return { proposed: false as const, reason: "No valid proposal (AI unavailable or output rejected by guardrails)." };
  const created = await createWorkflowVersion(ctx, adminId, sourceId, proposal.definition, `AI-assisted draft: ${proposal.summary}`);
  return { proposed: true as const, ...created, summary: proposal.summary };
}

export async function listFailedJobs(ctx: AppContext, includeResolved = false) {
  return ctx.db.query(
    "SELECT id, queue, job_name, job_id, source_id, error, attempts, payload_ref, resolved, created_at FROM failed_jobs WHERE ($1 OR NOT resolved) ORDER BY created_at DESC LIMIT 200",
    [includeResolved],
  );
}

export async function retryFailedJob(ctx: AppContext, adminId: string, id: number) {
  const job = await ctx.db.one<{ job_name: string; payload_ref: { requestId?: string } }>("SELECT job_name, payload_ref FROM failed_jobs WHERE id = $1", [id]);
  if (!job) throw notFound("Failed job");
  if (job.job_name === "RemovalJob" && job.payload_ref.requestId) {
    // Requeue as APPROVED only if the request is FAILED and the provider is not paused.
    const r = await ctx.db.one<{ id: string }>(
      `UPDATE removal_requests r SET status = 'APPROVED', last_error = NULL, updated_at = now()
       FROM discovered_records d LEFT JOIN data_sources s ON s.id = d.source_id
       WHERE r.id = $1 AND r.status = 'FAILED' AND d.id = r.record_id AND COALESCE(s.automation_paused, false) = false
       RETURNING r.id`,
      [job.payload_ref.requestId],
    );
    if (!r) throw badRequest("Request is not retryable (not failed, or provider paused).");
    await ctx.db.query("UPDATE removal_workflows SET state = 'PENDING' WHERE request_id = $1", [r.id]);
    await ctx.queue.enqueue(JobNames.Removal, { requestId: r.id }, { jobId: `removal:${r.id}:admin:${Date.now()}` });
  }
  await ctx.db.query("UPDATE failed_jobs SET resolved = true WHERE id = $1", [id]);
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "failed_job.retried", targetType: "failed_job", targetId: String(id) });
}

export async function resolveFailedJob(ctx: AppContext, adminId: string, id: number) {
  await ctx.db.query("UPDATE failed_jobs SET resolved = true WHERE id = $1", [id]);
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "failed_job.resolved", targetType: "failed_job", targetId: String(id) });
}

export async function listAbuseReports(ctx: AppContext) {
  return ctx.db.query(
    "SELECT id, subject_user_id, category, description, status, source, resolution_note, created_at, resolved_at FROM abuse_reports ORDER BY created_at DESC LIMIT 200",
  );
}

export async function updateAbuseReport(ctx: AppContext, adminId: string, id: string, patch: { status: string; note?: string; suspendUser?: boolean; clearProfileFlag?: boolean }) {
  const row = await ctx.db.one<{ subject_user_id: string | null }>(
    `UPDATE abuse_reports SET status = $2, resolution_note = COALESCE($3, resolution_note),
       resolved_at = CASE WHEN $2 IN ('ACTIONED','DISMISSED') THEN now() END WHERE id = $1 RETURNING subject_user_id`,
    [id, patch.status, patch.note ?? null],
  );
  if (!row) throw notFound("Abuse report");
  if (patch.suspendUser && row.subject_user_id) {
    await ctx.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [row.subject_user_id]);
    await ctx.db.query("DELETE FROM sessions WHERE user_id = $1", [row.subject_user_id]);
    await ctx.db.query(
      "UPDATE removal_requests SET status = 'CANCELLED', updated_at = now() WHERE profile_id IN (SELECT id FROM privacy_profiles WHERE user_id = $1) AND status IN ('APPROVED','AWAITING_APPROVAL','REQUIRES_USER_ACTION')",
      [row.subject_user_id],
    );
  }
  if (patch.clearProfileFlag && row.subject_user_id) {
    await ctx.db.query("UPDATE privacy_profiles SET flagged_for_review = false WHERE user_id = $1", [row.subject_user_id]);
  }
  await audit(ctx, { actorId: adminId, actorType: "admin", action: "abuse_report.updated", targetType: "abuse_report", targetId: id, metadata: { status: patch.status, suspended: !!patch.suspendUser } });
}

export async function auditTrail(ctx: AppContext, filter: { action?: string; limit?: number }) {
  return ctx.db.query(
    "SELECT id, actor_user_id, actor_type, action, target_type, target_id, metadata, created_at FROM audit_logs WHERE ($1::text IS NULL OR action LIKE $1 || '%') ORDER BY id DESC LIMIT $2",
    [filter.action ?? null, Math.min(500, filter.limit ?? 100)],
  );
}
