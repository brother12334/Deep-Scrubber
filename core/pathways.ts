import { FAVORABLE_OUTCOMES, CASE_OUTCOME_TEXT, type CaseOutcome, type Confidence, type DataType, type ExposureCategory, type RemovalMethod, type RemovalPathway } from "../shared/domain";

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
  /** Outcome of the arrest/case, as stated by the user. */
  caseOutcome?: CaseOutcome;
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
const favorable = (i: PathwayInput) => !!i.caseOutcome && FAVORABLE_OUTCOMES.includes(i.caseOutcome);
const arrestRelated = (i: PathwayInput) =>
  i.category === "MUGSHOT_OR_ARREST_RECORD" || i.category === "COURT_RECORD" || i.dataTypes.includes("ARREST_OR_COURT_RECORD");

export const PATHWAY_RULES: Rule[] = [
  {
    pathway: "MUGSHOT_REMOVAL",
    when: (i) => !i.isSearchResult && i.category === "MUGSHOT_OR_ARREST_RECORD",
    confidence: (i) => (favorable(i) ? "HIGH" : "MEDIUM"),
    why: (i) =>
      "Mugshot and arrest-record sites usually have a removal or contact process, and several US states restrict charging fees to remove booking photos." +
      (favorable(i) ? ` Because the case ${CASE_OUTCOME_TEXT[i.caseOutcome!]}, removal requests are more likely to succeed.` : ""),
    caveat: "Don't pay a site to remove a mugshot before checking your state's law — paying often doesn't stop the photo being republished elsewhere.",
  },
  {
    pathway: "NEWS_UPDATE_REQUEST",
    when: (i) => !i.isSearchResult && i.category === "NEWS_OR_PUBLIC_INTEREST" && favorable(i) && i.dataTypes.includes("ARREST_OR_COURT_RECORD"),
    confidence: () => "MEDIUM",
    why: (i) =>
      `Because the case ${CASE_OUTCOME_TEXT[i.caseOutcome!]}, you can ask the publisher to update the article with the outcome. ` +
      "Some newsrooms also review requests to remove names from, or unpublish, older coverage of arrests.",
    caveat: "The publisher decides. Accurate reporting doesn't have to be removed, but an update with the outcome is commonly granted.",
  },
  {
    pathway: "RECORD_SEALING",
    when: (i) => !i.isSearchResult && arrestRelated(i) && i.caseOutcome !== "EXPUNGED_OR_SEALED",
    // Most relevant for record sites; for news coverage, the publisher update comes first.
    confidence: (i) => (favorable(i) && i.category !== "NEWS_OR_PUBLIC_INTEREST" ? "MEDIUM" : "LOW"),
    why: () =>
      "If the record is eligible, sealing or expungement through the court is the step that makes most other removals possible. " +
      "A local criminal defense attorney or legal aid office can check eligibility.",
    caveat: "Eligibility depends on the state and the case. This is not legal advice.",
  },
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
    // Publisher update requests and court sealing are appropriate for public-interest content;
    // demands to remove accurate reporting are not.
    const keep: RemovalPathway[] = ["NEWS_UPDATE_REQUEST", "RECORD_SEALING"];
    return out
      .map((s) =>
        keep.includes(s.pathway)
          ? s
          : {
              ...s,
              confidence: "LOW" as Confidence,
              caveat: "This looks like lawful public-interest content. Removal requests are unlikely to be appropriate unless it contains private contact details.",
            },
      )
      .sort((a, b) => rank[b.confidence] - rank[a.confidence]);
  }
  return out.sort((a, b) => rank[b.confidence] - rank[a.confidence]);
}
