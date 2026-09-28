import type { AutomationStatus, DataType, ExposureCategory, PriorityLevel } from "../shared/domain";

/**
 * Prioritisation engine (spec §17). Produces a 0–100 score with a transparent
 * factor breakdown. Deliberately does NOT boost content just because it is
 * unfavourable; public-interest content is capped at LOW.
 */

export const SENSITIVITY: Record<DataType, number> = {
  HOME_ADDRESS: 30,
  PHONE: 22,
  EMAIL: 15,
  AGE_OR_DOB: 12,
  RELATIVES: 12,
  PHOTO: 8,
  LOCATION: 6,
  EMPLOYMENT: 6,
  USERNAME: 4,
  BIOGRAPHY: 3,
  NAME: 2,
};

export interface PriorityInput {
  dataTypes: DataType[];
  confidence: number;
  category: ExposureCategory;
  isSearchResult: boolean;
  hasOrigin: boolean;
  searchAppearances: number;
  bestSearchRank?: number | null;
  automationStatus?: AutomationStatus;
  /** Historical success rate from the platform's own data, only when sample size is sufficient. */
  historicalSuccessRate?: number | null;
  reappearsFrequently?: boolean;
  publicInterest: boolean;
}

export interface PriorityFactor {
  factor: string;
  points: number;
  detail: string;
}

export interface PriorityResult {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
}

const AUTOMATION_POINTS: Record<AutomationStatus, number> = {
  AUTOMATED: 10,
  SEMI_AUTOMATED: 8,
  USER_ACTION_REQUIRED: 5,
  MANUAL_REVIEW: 3,
  UNSUPPORTED: 0,
};

export function prioritize(i: PriorityInput): PriorityResult {
  const factors: PriorityFactor[] = [];
  const add = (factor: string, points: number, detail: string) => {
    if (points !== 0) factors.push({ factor, points: Math.round(points * 10) / 10, detail });
  };

  const sensitivity = Math.min(50, i.dataTypes.reduce((s, t) => s + SENSITIVITY[t], 0));
  add("sensitivity", sensitivity, `Contains: ${i.dataTypes.map((t) => t.toLowerCase().replace(/_/g, " ")).join(", ") || "name only"}`);

  add("accuracy", i.confidence * 15, `Match confidence ${(i.confidence * 100).toFixed(0)}%`);

  const exposureBase: Partial<Record<ExposureCategory, number>> = {
    DATA_BROKER: 10,
    PEOPLE_SEARCH: 10,
    DIRECTORY: 6,
    SOCIAL: 4,
    PROFESSIONAL: 3,
    SEARCH_RESULT: 3,
    USER_CONTROLLED: 4,
  };
  add("exposure", exposureBase[i.category] ?? 2, `Source type: ${i.category.toLowerCase().replace(/_/g, " ")}`);

  const visibility = Math.min(10, i.searchAppearances * 3) + (i.bestSearchRank && i.bestSearchRank <= 10 ? 5 : 0);
  add("search_visibility", visibility, `${i.searchAppearances} search appearance(s)`);

  const removal =
    i.historicalSuccessRate != null ? i.historicalSuccessRate * 10 : i.automationStatus ? AUTOMATION_POINTS[i.automationStatus] : 3;
  add("removal_likelihood", removal, i.historicalSuccessRate != null ? "Based on observed removal success" : "Based on available removal process");

  if (i.reappearsFrequently) add("reappearance", 5, "Source is known to regenerate records; monitoring matters");

  let score = factors.reduce((s, f) => s + f.points, 0);
  if (i.isSearchResult && i.hasOrigin) {
    const before = score;
    score *= 0.5;
    add("downstream", score - before, "Search appearance of a record handled at its original source");
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: PriorityLevel = score >= 55 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  if (i.publicInterest) {
    level = "LOW";
    factors.push({ factor: "public_interest", points: 0, detail: "Possible public-interest content: shown for awareness, not prioritised" });
  }
  return { score, level, factors };
}
