import { refineClassification } from "../../../ai/classifier";
import { PLANS } from "../../../core/abuse";
import { runDiscovery } from "../../../providers/discovery/engine";
import { agentFor } from "../../../removal-agents/registry";
import type { PlanId } from "../../../shared/domain";
import { AppError, badRequest, forbidden, notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { audit } from "./audit";
import { notifyProfileOwner } from "./notifications";
import { getOwnedProfile, loadSubject } from "./profiles";
import { persistDiscovery } from "./records";
import { planRemoval } from "./removals";
import { snapshotScore } from "./scoring";
import { allSources, baseUrlFor, registryLookup } from "./sources";
import type { SessionUser } from "./users";
import { ensureProfileRescan } from "./monitoring";

export async function createScan(ctx: AppContext, user: SessionUser, profileId: string | undefined, trigger: "USER" | "ONBOARDING" = "USER") {
  if (ctx.cfg.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email address before starting a scan.", 403);
  }
  const profile = await getOwnedProfile(ctx, user.id, profileId);
  const names = await ctx.db.one<{ n: number }>("SELECT count(*)::int AS n FROM identifiers WHERE profile_id = $1 AND type IN ('FULL_NAME')", [profile.id]);
  if (!names?.n) throw badRequest("Add your full name before scanning.");
  const plan = PLANS[user.plan];
  const rl = await ctx.rateLimiter.hit(`scan:${user.id}`, plan.scansPerDay, 24 * 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", `Your plan allows ${plan.scansPerDay} scan(s) per day.`, 429, { retryAfterSec: rl.retryAfterSec });
  const running = await ctx.db.one("SELECT 1 FROM scans WHERE profile_id = $1 AND status IN ('QUEUED','RUNNING') AND created_at > now() - interval '1 hour'", [profile.id]);
  if (running) throw new AppError("SCAN_IN_PROGRESS", "A scan is already running for this profile.", 409);
  const scan = await enqueueScan(ctx, profile.id, trigger);
  await audit(ctx, { actorId: user.id, actorType: "user", action: "scan.requested", targetType: "scan", targetId: scan.id });
  return scan;
}

export async function enqueueScan(ctx: AppContext, profileId: string, trigger: "USER" | "ONBOARDING" | "MONITORING") {
  const scan = (await ctx.db.one<{ id: string; status: string; created_at: Date }>(
    "INSERT INTO scans (profile_id, trigger) VALUES ($1, $2) RETURNING id, status, created_at",
    [profileId, trigger],
  ))!;
  await ctx.queue.enqueue(JobNames.Discovery, { scanId: scan.id }, { jobId: `scan:${scan.id}` });
  return scan;
}

export async function getScan(ctx: AppContext, profileId: string, scanId: string) {
  const s = await ctx.db.one("SELECT id, trigger, status, stats, error, created_at, started_at, finished_at FROM scans WHERE id = $1 AND profile_id = $2", [scanId, profileId]);
  if (!s) throw notFound("Scan");
  return s;
}

/** DiscoveryJob: DISCOVER → MATCH → CLASSIFY → PRIORITIZE → plan REQUEST REMOVAL. */
export async function runScan(ctx: AppContext, scanId: string): Promise<void> {
  const scan = await ctx.db.one<{ id: string; profile_id: string; status: string }>(
    "UPDATE scans SET status = 'RUNNING', started_at = now() WHERE id = $1 AND status IN ('QUEUED','RUNNING') RETURNING id, profile_id, status",
    [scanId],
  );
  if (!scan) return;
  try {
    const owner = (await ctx.db.one<{ plan: PlanId; flagged_for_review: boolean }>(
      "SELECT u.plan, p.flagged_for_review FROM privacy_profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1",
      [scan.profile_id],
    ))!;
    const subject = await loadSubject(ctx, scan.profile_id);
    const sources = (await allSources(ctx)).filter((s) => s.enabled && s.discoveryMethods.includes("SITE_SEARCH"));
    const http = ctx.http.scoped(15);
    const siteAgents = sources.map((s) => ({
      agent: agentFor(ctx.agents, s.agent),
      ctx: { source: s, baseUrl: baseUrlFor(ctx, s), http, now: () => ctx.clock.now() },
    }));
    const { hits, stats } = await runDiscovery(subject, {
      providers: ctx.searchProviders,
      registry: await registryLookup(ctx),
      http,
      siteAgents,
      maxQueries: owner.plan === "FREE" ? 8 : 30,
      maxPageFetches: owner.plan === "FREE" ? 5 : 20,
      log: (msg, meta) => ctx.log.warn({ scanId, ...meta }, msg),
    });
    // AI may add context to results the rules could not classify (never overrides the registry).
    for (const hit of hits) {
      if (hit.classification.category === "OTHER") {
        hit.classification = await refineClassification(ctx.llm, { url: hit.url, title: hit.title, text: hit.snippet, deterministic: hit.classification });
      }
    }
    const saved = await persistDiscovery(ctx, scan.profile_id, scan.id, subject, hits);
    for (const id of [...saved.newRecordIds, ...saved.reappearedRecordIds]) {
      try {
        await planRemoval(ctx, id);
      } catch (err) {
        ctx.log.warn({ scanId, err: String(err) }, "planning failed for record");
      }
    }
    const score = await snapshotScore(ctx, scan.profile_id);
    await ctx.db.query("UPDATE scans SET status = 'COMPLETED', finished_at = now(), stats = $2 WHERE id = $1", [
      scan.id,
      JSON.stringify({ ...stats, newRecords: saved.newRecordIds.length, reappeared: saved.reappearedRecordIds.length, score: score.score }),
    ]);
    const newPages = await ctx.db.one<{ brokers: number; total: number }>(
      `SELECT count(*) FILTER (WHERE category IN ('DATA_BROKER','PEOPLE_SEARCH'))::int AS brokers, count(*)::int AS total
       FROM discovered_records WHERE id = ANY($1) AND NOT is_search_result`,
      [saved.newRecordIds],
    );
    if ((newPages?.total ?? 0) > 0) {
      await notifyProfileOwner(ctx, scan.profile_id, {
        kind: "NEW_EXPOSURE",
        severity: "warning",
        title: `${newPages!.total} new exposure(s) found`,
        body: `${newPages!.brokers} on data-broker or people-search sites. Review them in your dashboard.`,
        link: "/exposures",
      });
    }
    if (saved.reappearedRecordIds.length) {
      await notifyProfileOwner(ctx, scan.profile_id, {
        kind: "REAPPEARED",
        severity: "critical",
        title: `${saved.reappearedRecordIds.length} previously removed profile(s) reappeared`,
        body: "The source may have regenerated the record. You can submit removal again.",
        link: "/exposures?status=REAPPEARED",
      });
    }
    if (PLANS[owner.plan].continuousMonitoring) await ensureProfileRescan(ctx, scan.profile_id);
    await audit(ctx, { actorType: "worker", action: "scan.completed", targetType: "scan", targetId: scan.id, metadata: { retained: stats.retained, new: saved.newRecordIds.length } });
  } catch (err) {
    await ctx.db.query("UPDATE scans SET status = 'FAILED', finished_at = now(), error = $2 WHERE id = $1", [scan.id, err instanceof Error ? err.message.slice(0, 500) : "error"]);
    throw err;
  }
}

export function assertCanScan(user: SessionUser) {
  if (user.role !== "user" && user.role !== "admin") throw forbidden();
}
