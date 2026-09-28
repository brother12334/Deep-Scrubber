import { computePrivacyScore, explainScoreChange, type PrivacyScore, type ScoreRecord } from "../../../core/scoring";
import type { AppContext } from "../context";

export async function currentScore(ctx: AppContext, profileId: string): Promise<PrivacyScore> {
  const rows = await ctx.db.query<{
    status: ScoreRecord["status"];
    priority_level: ScoreRecord["priorityLevel"];
    category: ScoreRecord["category"];
    is_search_result: boolean;
    parent_record_id: string | null;
    public_interest_flag: boolean;
  }>(
    "SELECT status, priority_level, category, is_search_result, parent_record_id, public_interest_flag FROM discovered_records WHERE profile_id = $1",
    [profileId],
  );
  return computePrivacyScore(
    rows.map((r) => ({
      status: r.status,
      priorityLevel: r.priority_level,
      category: r.category,
      isSearchResult: r.is_search_result,
      hasParent: !!r.parent_record_id,
      publicInterest: r.public_interest_flag,
    })),
  );
}

/** Store a snapshot when the score or its factors changed; returns the explanation. */
export async function snapshotScore(ctx: AppContext, profileId: string) {
  const next = await currentScore(ctx, profileId);
  const prevRow = await ctx.db.one<{ score: number; factors: PrivacyScore["factors"]; counts: PrivacyScore["counts"] }>(
    "SELECT score, factors, counts FROM privacy_score_snapshots WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1",
    [profileId],
  );
  const prev = prevRow ? { score: prevRow.score, factors: prevRow.factors, counts: prevRow.counts } : undefined;
  const change = explainScoreChange(prev, next);
  if (!prev || prev.score !== next.score || JSON.stringify(prev.factors) !== JSON.stringify(next.factors)) {
    await ctx.db.query("INSERT INTO privacy_score_snapshots (profile_id, score, factors, counts) VALUES ($1, $2, $3, $4)", [
      profileId,
      next.score,
      JSON.stringify(next.factors),
      JSON.stringify({ ...next.counts, change }),
    ]);
  }
  return { ...next, change };
}

export async function scoreHistory(ctx: AppContext, profileId: string) {
  const rows = await ctx.db.query<{ score: number; counts: { change?: { delta: number; reasons: string[] } }; created_at: Date }>(
    "SELECT score, counts, created_at FROM privacy_score_snapshots WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 90",
    [profileId],
  );
  return rows.map((r) => ({ score: r.score, at: r.created_at, change: r.counts.change ?? null }));
}
