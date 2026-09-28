import type { AppContext } from "../context";
import { currentScore } from "./scoring";

/** Dashboard summary (spec §15). */
export async function dashboard(ctx: AppContext, profileId: string) {
  const score = await currentScore(ctx, profileId);
  const last = await ctx.db.one<{ counts: { change?: { delta: number; reasons: string[] } } }>(
    "SELECT counts FROM privacy_score_snapshots WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1",
    [profileId],
  );
  const cards = await ctx.db.one<{ active: number; removed: number; requires_action: number; reappeared: number; needs_review: number }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('READY','AWAITING_APPROVAL','SUBMITTED','AWAITING_VERIFICATION','PARTIALLY_REMOVED'))::int AS active,
       count(*) FILTER (WHERE status = 'REMOVED')::int AS removed,
       count(*) FILTER (WHERE status IN ('REQUIRES_USER_ACTION','AWAITING_APPROVAL'))::int AS requires_action,
       count(*) FILTER (WHERE status = 'REAPPEARED')::int AS reappeared,
       count(*) FILTER (WHERE status = 'NEEDS_REVIEW')::int AS needs_review
     FROM discovered_records WHERE profile_id = $1 AND NOT is_search_result`,
    [profileId],
  );
  const activity = await ctx.db.query<{ kind: string; severity: string; title: string; body: string; link: string | null; created_at: Date }>(
    "SELECT kind, severity, title, body, link, created_at FROM notifications WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 12",
    [profileId],
  );
  const actions = await ctx.db.query<{ id: string; user_action: unknown; source_name: string | null; domain: string }>(
    `SELECT r.id, r.user_action, s.name AS source_name, d.domain FROM removal_requests r
     JOIN discovered_records d ON d.id = r.record_id LEFT JOIN data_sources s ON s.id = r.source_id
     WHERE r.profile_id = $1 AND r.status = 'REQUIRES_USER_ACTION' ORDER BY r.updated_at DESC LIMIT 10`,
    [profileId],
  );
  const lastScan = await ctx.db.one("SELECT id, status, trigger, stats, created_at, finished_at FROM scans WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1", [profileId]);
  return {
    score: { value: score.score, factors: score.factors, counts: score.counts, lastChange: last?.counts.change ?? null },
    cards: {
      activeRemovals: cards?.active ?? 0,
      removed: cards?.removed ?? 0,
      requiresAction: cards?.requires_action ?? 0,
      reappeared: cards?.reappeared ?? 0,
      needsReview: cards?.needs_review ?? 0,
    },
    actionsRequired: actions.map((a) => ({ requestId: a.id, sourceName: a.source_name ?? a.domain, action: a.user_action })),
    recentActivity: activity,
    lastScan: lastScan ?? null,
  };
}
