import type { CandidateAttributes } from "./extract";
import type { SubjectProfile } from "./subject";
import { normalizeName } from "./normalize";

/**
 * Identity-resolution engine (spec §3).
 *
 * Rather than treating any single identifier hit as a match, evidence is
 * combined with a naive-Bayes style likelihood-ratio model:
 *
 *   posterior odds = prior odds × Π LR(evidence)
 *
 * Strong unique identifiers (email, phone) move the needle a lot; names alone
 * cannot exceed "weak"; contradicting evidence (wrong age, only foreign
 * locations) pulls confidence down. Every factor is recorded so the UI can
 * explain the score.
 */

export type MatchBand = "VERY_STRONG" | "STRONG" | "POSSIBLE" | "WEAK" | "UNRELATED";

export const MATCH_THRESHOLDS = {
  VERY_STRONG: 0.95,
  STRONG: 0.8,
  POSSIBLE: 0.6,
  WEAK: 0.4,
} as const;

/** Minimum confidence for automated submission without explicit user confirmation. */
export const AUTO_SUBMIT_MIN_CONFIDENCE = MATCH_THRESHOLDS.STRONG;
/** Below this we do not retain the result at all (data minimisation: likely someone else). */
export const RETAIN_MIN_CONFIDENCE = MATCH_THRESHOLDS.WEAK;

export interface MatchFactor {
  factor: string;
  effect: "supports" | "contradicts" | "neutral";
  likelihoodRatio: number;
  detail: string;
}

export interface MatchResult {
  confidence: number;
  band: MatchBand;
  factors: MatchFactor[];
}

const LR = {
  fullName: 12,
  previousName: 8,
  email: 400,
  phone: 300,
  username: 25,
  cityState: 4,
  stateOnly: 1.6,
  ageConsistent: 3,
  ageInconsistent: 0.15,
  locationConflict: 0.45,
  noNameButStrongId: 0.8,
  domain: 60,
} as const;

export interface MatchContext {
  /** Prior probability that a result from this discovery channel is the subject. */
  prior?: number;
  /** Result came from a site search seeded with the subject's name + location. */
  targetedSearch?: boolean;
  url?: string;
  now?: Date;
}

export function bandFor(confidence: number): MatchBand {
  if (confidence >= MATCH_THRESHOLDS.VERY_STRONG) return "VERY_STRONG";
  if (confidence >= MATCH_THRESHOLDS.STRONG) return "STRONG";
  if (confidence >= MATCH_THRESHOLDS.POSSIBLE) return "POSSIBLE";
  if (confidence >= MATCH_THRESHOLDS.WEAK) return "WEAK";
  return "UNRELATED";
}

export function scoreMatch(subject: SubjectProfile, cand: CandidateAttributes, ctx: MatchContext = {}): MatchResult {
  const prior = ctx.prior ?? (ctx.targetedSearch ? 0.1 : 0.05);
  let odds = prior / (1 - prior);
  const factors: MatchFactor[] = [];
  const apply = (factor: string, lr: number, detail: string) => {
    odds *= lr;
    factors.push({ factor, likelihoodRatio: lr, detail, effect: lr > 1 ? "supports" : lr < 1 ? "contradicts" : "neutral" });
  };

  const current = new Set(subject.names.map(normalizeName));
  const previous = new Set(subject.previousNames.map(normalizeName));
  const nameHit = cand.names.find((n) => current.has(n));
  const prevHit = !nameHit && cand.names.find((n) => previous.has(n));
  if (nameHit) apply("name", LR.fullName, "Full name appears on the page");
  else if (prevHit) apply("previous_name", LR.previousName, "A previous name or alias appears on the page");

  const emailHits = cand.emails.filter((e) => subject.emails.includes(e));
  if (emailHits.length) apply("email", LR.email, `${emailHits.length} of your email address(es) appear`);

  const phoneHits = cand.phones.filter((p) => subject.phones.includes(p));
  if (phoneHits.length) apply("phone", LR.phone, `${phoneHits.length} of your phone number(s) appear`);

  const userHits = cand.usernames.filter((u) => subject.usernames.includes(u));
  if (userHits.length) apply("username", LR.username, "One of your usernames appears");

  if (ctx.url && subject.domains.length) {
    try {
      const host = new URL(ctx.url).hostname.replace(/^www\./, "");
      if (subject.domains.some((d) => host === d || host.endsWith(`.${d}`))) apply("domain", LR.domain, "Page is on a domain you own");
    } catch {
      /* ignore */
    }
  }

  if (subject.locations.length && cand.locations.length) {
    const cityState = cand.locations.some((l) => {
      const [city, st] = l.split(",");
      return subject.locations.some((s) => s.city && s.region && s.city === city && s.region === st);
    });
    const stateOnly = !cityState && cand.locations.some((l) => subject.locations.some((s) => s.region && l.endsWith(`,${s.region}`)));
    if (cityState) apply("location", LR.cityState, "A city/state you lived in appears");
    else if (stateOnly) apply("location_state", LR.stateOnly, "A state you lived in appears");
    else apply("location_conflict", LR.locationConflict, "Only locations you have not listed appear");
  }

  if (subject.dateOfBirth && cand.ages.length) {
    const age = ageOn(subject.dateOfBirth, ctx.now ?? new Date());
    if (age !== undefined) {
      if (cand.ages.some((a) => Math.abs(a - age) <= 1)) apply("age", LR.ageConsistent, "Listed age is consistent with your date of birth");
      else apply("age_conflict", LR.ageInconsistent, "Listed age does not match your date of birth");
    }
  }

  if (!nameHit && !prevHit && (emailHits.length || phoneHits.length)) {
    apply("no_name", LR.noNameButStrongId, "Your name does not appear alongside the identifier");
  }

  const confidence = factors.length === 0 ? 0 : Math.min(0.99, round3(odds / (1 + odds)));
  return { confidence, band: bandFor(confidence), factors };
}

export function canAutoSubmit(confidence: number, userConfirmed: boolean | null | undefined): boolean {
  if (userConfirmed === false) return false;
  return userConfirmed === true || confidence >= AUTO_SUBMIT_MIN_CONFIDENCE;
}

function ageOn(dob: string, now: Date): number | undefined {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
