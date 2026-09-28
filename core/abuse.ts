import type { PlanId, ProfileRelationship } from "../shared/domain";

/**
 * Abuse prevention rules (spec §29). The platform exists to remove a person's
 * *own* information (or that of someone who authorised it); these checks make
 * bulk targeting of unrelated people impractical.
 */

export interface PlanEntitlements {
  maxProfiles: number;
  allowedRelationships: ProfileRelationship[];
  automatedRemoval: boolean;
  continuousMonitoring: boolean;
  scansPerDay: number;
  maxIdentifiersPerType: number;
  maxNamesPerProfile: number;
}

export const PLANS: Record<PlanId, PlanEntitlements & { name: string; priceMonthlyUsd: number; summary: string[] }> = {
  FREE: {
    name: "Free",
    priceMonthlyUsd: 0,
    summary: ["Limited scan", "Manual removal guidance"],
    maxProfiles: 1,
    allowedRelationships: ["SELF"],
    automatedRemoval: false,
    continuousMonitoring: false,
    scansPerDay: 1,
    maxIdentifiersPerType: 3,
    maxNamesPerProfile: 2,
  },
  PRO: {
    name: "Pro",
    priceMonthlyUsd: 12,
    summary: ["Full monitoring", "Automated removal", "Continuous rescans"],
    maxProfiles: 1,
    allowedRelationships: ["SELF"],
    automatedRemoval: true,
    continuousMonitoring: true,
    scansPerDay: 6,
    maxIdentifiersPerType: 10,
    maxNamesPerProfile: 5,
  },
  FAMILY: {
    name: "Family",
    priceMonthlyUsd: 24,
    summary: ["Up to 5 authorized profiles", "Everything in Pro"],
    maxProfiles: 5,
    allowedRelationships: ["SELF", "FAMILY_MEMBER"],
    automatedRemoval: true,
    continuousMonitoring: true,
    scansPerDay: 12,
    maxIdentifiersPerType: 10,
    maxNamesPerProfile: 5,
  },
  BUSINESS: {
    name: "Business",
    priceMonthlyUsd: 0,
    summary: ["Employee and company-owned information monitoring", "Requires signed authorization"],
    maxProfiles: 250,
    allowedRelationships: ["SELF", "EMPLOYEE", "COMPANY"],
    automatedRemoval: true,
    continuousMonitoring: true,
    scansPerDay: 500,
    maxIdentifiersPerType: 10,
    maxNamesPerProfile: 5,
  },
};

export interface AbuseSignal {
  code: string;
  severity: "info" | "review" | "block";
  detail: string;
}

export interface ProfileShape {
  distinctNames: number;
  distinctLastNames: number;
  emailsClaimedByOtherAccounts: number;
  phonesClaimedByOtherAccounts: number;
  identifierChurnLast24h: number;
}

/**
 * Heuristics for a profile being used to target other people. "block" stops
 * the action; "review" flags the profile for a human reviewer and pauses
 * automated submissions until cleared.
 */
export function assessProfileAbuse(p: ProfileShape): AbuseSignal[] {
  const signals: AbuseSignal[] = [];
  if (p.distinctLastNames > 3) {
    signals.push({ code: "MANY_UNRELATED_NAMES", severity: "review", detail: "Profile contains many unrelated surnames." });
  }
  if (p.emailsClaimedByOtherAccounts > 0 || p.phonesClaimedByOtherAccounts > 0) {
    signals.push({
      code: "IDENTIFIER_CLAIMED_ELSEWHERE",
      severity: "review",
      detail: "An email or phone number on this profile is also claimed by another account.",
    });
  }
  if (p.identifierChurnLast24h > 40) {
    signals.push({ code: "HIGH_IDENTIFIER_CHURN", severity: "block", detail: "Identifiers are being changed unusually often." });
  }
  return signals;
}
