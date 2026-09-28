import type { ExposureCategory, PriorityLevel, RecordStatus } from "../shared/domain";
import { ACTIVE_EXPOSURE_STATUSES } from "../shared/domain";

/**
 * Privacy score (spec §14): 100 means nothing actionable was found.
 * It is a transparent tally of penalties, not a security measurement, and
 * every point is attributable to a factor shown to the user.
 */

export interface ScoreRecord {
  status: RecordStatus;
  priorityLevel: PriorityLevel;
  category: ExposureCategory;
  isSearchResult: boolean;
  hasParent: boolean;
  publicInterest: boolean;
}

export interface ScoreFactor {
  key: string;
  label: string;
  count: number;
  pointsEach: number;
  points: number;
}

export interface PrivacyScore {
  score: number;
  factors: ScoreFactor[];
  counts: {
    publicRecords: number;
    dataBrokers: number;
    publicProfiles: number;
    searchResultsRequiringAction: number;
    highPriority: number;
    removed: number;
    reappeared: number;
  };
}

const PENALTY: Record<PriorityLevel, number> = { HIGH: 6, MEDIUM: 3, LOW: 1 };

export function computePrivacyScore(records: ScoreRecord[]): PrivacyScore {
  const active = records.filter((r) => ACTIVE_EXPOSURE_STATUSES.includes(r.status));
  const counts = {
    publicRecords: active.filter((r) => !r.isSearchResult).length,
    dataBrokers: active.filter((r) => !r.isSearchResult && (r.category === "DATA_BROKER" || r.category === "PEOPLE_SEARCH")).length,
    publicProfiles: active.filter((r) => r.category === "SOCIAL" || r.category === "PROFESSIONAL").length,
    searchResultsRequiringAction: active.filter((r) => r.isSearchResult).length,
    highPriority: active.filter((r) => r.priorityLevel === "HIGH" && !r.publicInterest).length,
    removed: records.filter((r) => r.status === "REMOVED").length,
    reappeared: records.filter((r) => r.status === "REAPPEARED").length,
  };

  const factors: ScoreFactor[] = [];
  const push = (key: string, label: string, count: number, pointsEach: number) => {
    if (count > 0) factors.push({ key, label, count, pointsEach, points: -round1(count * pointsEach) });
  };
  const primary = active.filter((r) => !r.isSearchResult && !r.publicInterest);
  for (const level of ["HIGH", "MEDIUM", "LOW"] as const) {
    push(`${level.toLowerCase()}_priority`, `${cap(level)}-priority exposures`, primary.filter((r) => r.priorityLevel === level).length, PENALTY[level]);
  }
  push("search_appearances", "Search results pointing at your information", active.filter((r) => r.isSearchResult).length, 0.5);
  push("reappeared", "Records that reappeared after removal", counts.reappeared, 2);

  const penalty = factors.reduce((s, f) => s - f.points, 0);
  return { score: Math.max(0, Math.round(100 - penalty)), factors, counts };
}

export interface ScoreChange {
  delta: number;
  reasons: string[];
}

/** Explain exactly why the score moved between two snapshots. */
export function explainScoreChange(prev: PrivacyScore | undefined, next: PrivacyScore): ScoreChange {
  if (!prev) return { delta: 0, reasons: ["First score calculated from your initial scan."] };
  const reasons: string[] = [];
  const keys = new Set([...prev.factors.map((f) => f.key), ...next.factors.map((f) => f.key)]);
  for (const key of keys) {
    const a = prev.factors.find((f) => f.key === key);
    const b = next.factors.find((f) => f.key === key);
    const diff = (b?.count ?? 0) - (a?.count ?? 0);
    if (diff === 0) continue;
    const label = (b ?? a)!.label.toLowerCase();
    const pts = round1(-diff * (b ?? a)!.pointsEach);
    reasons.push(`${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${label} (${pts >= 0 ? "+" : ""}${pts} points)`);
  }
  return { delta: next.score - prev.score, reasons: reasons.length ? reasons : ["No change."] };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
