import type { Confidence, DataType, ExposureCategory, RemovalMethod, RemovalPathway } from "../shared/domain";

/**
 * Legal/policy pathway classifier (spec §11). Identifies *potentially*
 * applicable mechanisms and explains why — it never states that a right
 * definitely applies, and it is not legal advice.
 */

export interface PathwayInput {
  category: ExposureCategory;
  isSearchResult: boolean;
  sourceRemovalMethods: RemovalMethod[];
  userOwnsDomain: boolean;
  originGone: boolean;
  dataTypes: DataType[];
  publicInterest: boolean;
  jurisdictionMechanisms: string[];
  jurisdictionName?: string;
  userFlaggedImpersonation?: boolean;
  userOwnsCopyright?: boolean;
}

export interface PathwaySuggestion {
  pathway: RemovalPathway;
  confidence: Confidence;
  why: string;
  caveat?: string;
}

interface Rule {
  pathway: RemovalPathway;
  when: (i: PathwayInput) => boolean;
  confidence: (i: PathwayInput) => Confidence;
  why: (i: PathwayInput) => string;
  caveat?: string;
}

const SENSITIVE: DataType[] = ["HOME_ADDRESS", "PHONE", "EMAIL", "AGE_OR_DOB"];

export const PATHWAY_RULES: Rule[] = [
  {
    pathway: "USER_CONTROLLED_WEBSITE",
    when: (i) => i.userOwnsDomain,
    confidence: () => "HIGH",
    why: () => "The page is on a domain you told us you control, so you can change or remove it directly.",
  },
  {
    pathway: "DATA_BROKER_OPT_OUT",
    when: (i) => !i.isSearchResult && (i.category === "DATA_BROKER" || i.category === "PEOPLE_SEARCH") && i.sourceRemovalMethods.some((m) => m !== "NONE"),
    confidence: () => "HIGH",
    why: () => "This provider offers a consumer privacy removal (opt-out) mechanism.",
  },
  {
    pathway: "JURISDICTIONAL_DELETION_REQUEST",
    when: (i) => !i.isSearchResult && !i.publicInterest && i.jurisdictionMechanisms.includes("JURISDICTIONAL_DELETION_REQUEST"),
    confidence: () => "MEDIUM",
    why: (i) => `Your listed region (${i.jurisdictionName ?? "your jurisdiction"}) may provide a right to request deletion from some businesses.`,
    caveat: "Whether it applies depends on the business and on exemptions. This is not legal advice.",
  },
  {
    pathway: "PLATFORM_PRIVACY_REQUEST",
    when: (i) => !i.isSearchResult && (i.category === "SOCIAL" || i.category === "PROFESSIONAL"),
    confidence: (i) => (i.sourceRemovalMethods.includes("ACCOUNT_SETTINGS") ? "HIGH" : "MEDIUM"),
    why: () => "The platform provides account settings or a privacy request process for content about you.",
  },
  {
    pathway: "SEARCH_RESULT_PRIVACY_REMOVAL",
    when: (i) => i.isSearchResult && i.dataTypes.some((t) => SENSITIVE.includes(t)),
    confidence: () => "MEDIUM",
    why: () => "Search engines offer processes to request removal of results showing personal contact information.",
    caveat: "Removal from search results does not remove the page from the original website.",
  },
  {
    pathway: "OUTDATED_CONTENT",
    when: (i) => i.isSearchResult && i.originGone,
    confidence: () => "HIGH",
    why: () => "The original page no longer shows this information but a search result still does; outdated-content refresh tools apply.",
  },
  {
    pathway: "PERSONAL_INFORMATION_EXPOSURE",
    when: (i) => !i.isSearchResult && !i.publicInterest && i.dataTypes.some((t) => SENSITIVE.includes(t)) && i.category === "OTHER",
    confidence: () => "LOW",
    why: () => "The page exposes personal contact details; many sites will remove them on request via their contact or privacy process.",
  },
  {
    pathway: "IMPERSONATION",
    when: (i) => !!i.userFlaggedImpersonation,
    confidence: () => "MEDIUM",
    why: () => "You indicated this profile impersonates you; platforms typically have dedicated impersonation reports.",
    caveat: "Platforms may ask you to verify your identity directly with them.",
  },
  {
    pathway: "COPYRIGHT",
    when: (i) => !!i.userOwnsCopyright,
    confidence: () => "LOW",
    why: () => "You indicated you own the copyright in material on this page.",
    caveat: "Copyright notices have legal consequences. Only submit one if you are the rights holder.",
  },
  {
    pathway: "GENERAL_PRIVACY_OPT_OUT",
    when: (i) => !i.isSearchResult && !i.publicInterest,
    confidence: () => "LOW",
    why: () => "Many websites honour general privacy requests even without a formal opt-out process.",
  },
];

const rank: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function suggestPathways(input: PathwayInput): PathwaySuggestion[] {
  const out = PATHWAY_RULES.filter((r) => r.when(input)).map((r) => ({
    pathway: r.pathway,
    confidence: r.confidence(input),
    why: r.why(input),
    ...(r.caveat ? { caveat: r.caveat } : {}),
  }));
  if (input.publicInterest) {
    return out.map((s) => ({
      ...s,
      confidence: "LOW" as Confidence,
      caveat: "This looks like lawful public-interest content. Removal requests are unlikely to be appropriate unless it contains private contact details.",
    }));
  }
  return out.sort((a, b) => rank[b.confidence] - rank[a.confidence]);
}
