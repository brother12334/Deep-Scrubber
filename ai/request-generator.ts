import { z } from "zod";
import { CASE_OUTCOME_TEXT, type CaseOutcome, type DataType, type RemovalMethod, type RemovalPathway } from "../shared/domain";
import type { LLMProvider } from "./provider";

/**
 * Removal request generator (spec §10).
 *
 * A deterministic template always produces a valid draft. If an AI provider
 * is configured it may rewrite the draft for the specific context, but the
 * rewrite is rejected unless it passes guardrails:
 *   - no contact details, URLs or names that were not supplied as facts
 *   - no legal frameworks except those the pathway engine surfaced
 *   - no threats or claims of legal representation
 *   - bounded length
 * The user always previews, can edit, and must approve before submission
 * (unless they granted blanket authorization for low-risk automated sources).
 */

export interface RequestFacts {
  recipientName: string;
  recipientAddress?: string;
  method: RemovalMethod;
  pathway: RemovalPathway;
  listingUrl: string;
  dataTypes: DataType[];
  subjectName: string;
  contactEmail?: string;
  /** Free-text facts the user explicitly provided (e.g. "I moved in 2021"). */
  userFacts: string[];
  /** Frameworks the pathway engine surfaced for the user's jurisdiction; may be empty. */
  allowedFrameworks: string[];
  /** Outcome of the arrest/case as stated by the user (only used for arrest-related pathways). */
  caseOutcome?: CaseOutcome;
}

export interface GeneratedRequest {
  subject: string;
  body: string;
  reason: string;
  generatedBy: "template" | "ai";
  guardrailViolations: string[];
}

const DATA_LABEL: Record<DataType, string> = {
  NAME: "name",
  HOME_ADDRESS: "home address",
  PHONE: "phone number",
  EMAIL: "email address",
  AGE_OR_DOB: "age / date of birth",
  RELATIVES: "names of relatives",
  USERNAME: "usernames",
  PHOTO: "photo",
  EMPLOYMENT: "employment details",
  BIOGRAPHY: "biographical details",
  LOCATION: "location history",
  ARREST_OR_COURT_RECORD: "arrest or court record",
};

const PATHWAY_REASON: Record<RemovalPathway, string> = {
  DATA_BROKER_OPT_OUT: "User is requesting removal of their personal information through the provider's available privacy opt-out process.",
  GENERAL_PRIVACY_OPT_OUT: "User is requesting removal of their personal information through the provider's privacy process.",
  SEARCH_RESULT_PRIVACY_REMOVAL: "User is requesting removal of a search result that displays their personal contact information.",
  OUTDATED_CONTENT: "The source page no longer contains this information; the search result is outdated.",
  COPYRIGHT: "User states they own the copyright in the material.",
  IMPERSONATION: "User reports that the profile impersonates them.",
  PERSONAL_INFORMATION_EXPOSURE: "The page exposes the user's personal contact information.",
  USER_CONTROLLED_WEBSITE: "The page is on a website the user controls.",
  PLATFORM_PRIVACY_REQUEST: "User is requesting removal through the platform's privacy process.",
  JURISDICTIONAL_DELETION_REQUEST: "User is requesting deletion of their personal information under privacy rights that may apply in their jurisdiction.",
  MUGSHOT_REMOVAL: "User is requesting removal of a booking photo / arrest record through the site's removal process.",
  NEWS_UPDATE_REQUEST: "User is asking the publisher to update the article with the case outcome and to consider its policy for older arrest coverage.",
  RECORD_SEALING: "Court record sealing or expungement is handled by the court, not by a request to a website.",
};

function arrestTemplate(f: RequestFacts): GeneratedRequest | null {
  const outcome = f.caseOutcome && f.caseOutcome !== "NONE" ? CASE_OUTCOME_TEXT[f.caseOutcome] : "";
  const facts = f.userFacts.length ? `\n\nAdditional information: ${f.userFacts.join(" ")}` : "";
  const signoff = ["", f.contactEmail ? `You can reach me at ${f.contactEmail}.` : "", "", "Thank you,", f.subjectName];
  if (f.pathway === "NEWS_UPDATE_REQUEST") {
    return {
      subject: "Request to update an article with the case outcome",
      body: [
        `Hello ${f.recipientName} editors,`,
        "",
        `I am writing about your article at ${f.listingUrl}, which reports my arrest.${outcome ? ` The case ${outcome}.` : ""}`,
        "",
        "I'm asking that you update the article to reflect this outcome. If your newsroom has a policy for reviewing older coverage of arrests, I would also be grateful if you would consider removing my name or unpublishing the article under that policy." +
          " I can provide court documentation of the outcome if that would help.",
        facts,
        ...signoff,
      ].join("\n").replace(/\n{3,}/g, "\n\n"),
      reason: PATHWAY_REASON[f.pathway],
      generatedBy: "template",
      guardrailViolations: [],
    };
  }
  if (f.pathway === "MUGSHOT_REMOVAL") {
    return {
      subject: "Booking photo / arrest record removal request",
      body: [
        `Hello ${f.recipientName},`,
        "",
        `I am requesting the removal of my booking photo and arrest information from your website: ${f.listingUrl}`,
        outcome ? `\nThe case ${outcome}.` : "",
        facts,
        ...signoff,
      ].join("\n").replace(/\n{3,}/g, "\n\n"),
      reason: PATHWAY_REASON[f.pathway],
      generatedBy: "template",
      guardrailViolations: [],
    };
  }
  return null;
}

export function templateRequest(f: RequestFacts): GeneratedRequest {
  const special = arrestTemplate(f);
  if (special) return special;
  const items = f.dataTypes.filter((t) => t !== "NAME").map((t) => DATA_LABEL[t]);
  const itemsText = items.length ? `, including my ${joinList(items)}` : "";
  const frameworks =
    f.pathway === "JURISDICTIONAL_DELETION_REQUEST" && f.allowedFrameworks.length
      ? ` To the extent they apply to your business, I am making this request under ${joinList(f.allowedFrameworks)}.`
      : "";
  const facts = f.userFacts.length ? `\n\nAdditional information: ${f.userFacts.join(" ")}` : "";
  const body = [
    `Hello ${f.recipientName} privacy team,`,
    "",
    `I am requesting the removal of my personal information from your service. The listing is: ${f.listingUrl}`,
    "",
    `Please remove the record associated with my name (${f.subjectName})${itemsText}, and suppress it from being re-published.${frameworks}${facts}`,
    "",
    f.contactEmail ? `Please send confirmation to ${f.contactEmail}.` : "Please confirm once the removal is complete.",
    "",
    "Thank you,",
    f.subjectName,
  ].join("\n");
  return {
    subject: `Personal information removal request`,
    body,
    reason: PATHWAY_REASON[f.pathway],
    generatedBy: "template",
    guardrailViolations: [],
  };
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s)>"']+/gi;
const PHONE_RE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const LEGAL_TERMS = /\b(GDPR|CCPA|CPRA|PIPEDA|UK GDPR|Data Protection Act|Delete Act|Article \d+|Section \d+|§)/gi;
const THREATS = /\b(lawsuit|sue|suing|attorney|lawyer|legal action|court order|penalt(y|ies)|fine[sd]?\b|liable|litigation)\b/i;

export function checkGuardrails(text: string, f: RequestFacts): string[] {
  const v: string[] = [];
  const allowedEmails = new Set([f.contactEmail, f.recipientAddress].filter(Boolean).map((e) => e!.toLowerCase()));
  for (const e of text.match(EMAIL_RE) ?? []) if (!allowedEmails.has(e.toLowerCase())) v.push(`unexpected email ${e}`);
  for (const u of text.match(URL_RE) ?? []) if (u.replace(/[.,]$/, "") !== f.listingUrl) v.push("unexpected URL");
  const allowedFacts = f.userFacts.join(" ");
  for (const p of text.match(PHONE_RE) ?? []) if (!allowedFacts.includes(p)) v.push("phone number not supplied by user");
  const allowedLegal = f.pathway === "JURISDICTIONAL_DELETION_REQUEST" ? f.allowedFrameworks.join(" ") : "";
  for (const t of text.match(LEGAL_TERMS) ?? []) if (!allowedLegal.includes(t)) v.push(`legal reference not supported by pathway: ${t}`);
  if (THREATS.test(text)) v.push("threatening or legal-representation language");
  if (text.length > 2500) v.push("too long");
  if (!text.includes(f.listingUrl)) v.push("listing URL missing");
  return v;
}

const DraftSchema = z.object({ subject: z.string().max(140), body: z.string().max(2500) });

export async function generateRemovalRequest(f: RequestFacts, llm?: LLMProvider): Promise<GeneratedRequest> {
  const base = templateRequest(f);
  if (!llm || llm.id === "none") return base;
  const draft = await llm.generateJson({
    task: "draft_removal_request",
    schema: DraftSchema,
    maxTokens: 1500,
    system: [
      "You draft short, polite personal-information removal requests on behalf of the person the information is about.",
      "Use ONLY the facts provided. Never invent facts, dates, laws, rights, deadlines or consequences.",
      "Do not cite any law unless it appears in allowed_frameworks. Do not threaten. Do not claim to be a lawyer.",
      "Include the listing URL verbatim. Keep it under 180 words. Plain text, no markdown.",
    ].join(" "),
    prompt: JSON.stringify({
      recipient: f.recipientName,
      listing_url: f.listingUrl,
      personal_data_shown: f.dataTypes.map((t) => DATA_LABEL[t]),
      requester_name: f.subjectName,
      reply_to: f.contactEmail ?? null,
      pathway: f.pathway,
      allowed_frameworks: f.pathway === "JURISDICTIONAL_DELETION_REQUEST" ? f.allowedFrameworks : [],
      user_facts: f.userFacts,
      reference_draft: base.body,
    }),
  });
  if (!draft) return base;
  const violations = [...checkGuardrails(draft.body, f), ...checkGuardrails(draft.subject, { ...f, listingUrl: draft.subject }).filter((x) => x !== "listing URL missing")];
  if (violations.length) return { ...base, guardrailViolations: violations };
  return { subject: draft.subject, body: draft.body, reason: base.reason, generatedBy: "ai", guardrailViolations: [] };
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
