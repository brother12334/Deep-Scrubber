export type Tone = "green" | "amber" | "red" | "blue" | "gray";

/** Status → label and colour. Colour means status (spec §41). */
export const RECORD_STATUS: Record<string, { label: string; tone: Tone }> = {
  DISCOVERED: { label: "Discovered", tone: "gray" },
  NEEDS_REVIEW: { label: "Needs review", tone: "amber" },
  READY: { label: "Ready", tone: "gray" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "amber" },
  SUBMITTED: { label: "Submitted", tone: "blue" },
  AWAITING_VERIFICATION: { label: "Awaiting verification", tone: "blue" },
  REMOVED: { label: "Removed", tone: "green" },
  PARTIALLY_REMOVED: { label: "Partially removed", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
  REQUIRES_USER_ACTION: { label: "Action required", tone: "amber" },
  REAPPEARED: { label: "Reappeared", tone: "red" },
  NO_ACTION_AVAILABLE: { label: "No action available", tone: "gray" },
  DISMISSED: { label: "Not me", tone: "gray" },
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "amber" },
  APPROVED: { label: "Queued", tone: "blue" },
  IN_PROGRESS: { label: "Processing", tone: "blue" },
  REQUIRES_USER_ACTION: { label: "Action required", tone: "amber" },
  SUBMITTED: { label: "Submitted", tone: "blue" },
  AWAITING_VERIFICATION: { label: "Verifying", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

export const OUTCOME: Record<string, { label: string; tone: Tone; help: string }> = {
  REMOVED_FROM_SOURCE: { label: "Removed from source", tone: "green", help: "The page is gone from the website." },
  REMOVED_FROM_SEARCH_RESULTS: { label: "Removed from search results", tone: "green", help: "The search engine no longer lists it. The original page may still exist." },
  NO_LONGER_DETECTED: { label: "No longer detected", tone: "green", help: "The page loads, but your information no longer appears on it." },
  STILL_PRESENT: { label: "Still present", tone: "amber", help: "The listing is still live." },
  PARTIALLY_REMOVED: { label: "Partially removed", tone: "amber", help: "Some details were removed." },
  INCONCLUSIVE: { label: "Inconclusive", tone: "gray", help: "We couldn't check automatically." },
};

export const CATEGORY: Record<string, string> = {
  DATA_BROKER: "Data broker",
  PEOPLE_SEARCH: "People search",
  SOCIAL: "Social",
  DIRECTORY: "Directory",
  PROFESSIONAL: "Professional",
  BUSINESS: "Business",
  SEARCH_RESULT: "Search result",
  USER_CONTROLLED: "Your website",
  NEWS_OR_PUBLIC_INTEREST: "News / public interest",
  MUGSHOT_OR_ARREST_RECORD: "Mugshot / arrest record",
  COURT_RECORD: "Court record",
  OTHER: "Other",
};

export const DATA_TYPE: Record<string, string> = {
  NAME: "Name",
  HOME_ADDRESS: "Home address",
  PHONE: "Phone",
  EMAIL: "Email",
  AGE_OR_DOB: "Age",
  RELATIVES: "Relatives",
  USERNAME: "Username",
  PHOTO: "Photo",
  EMPLOYMENT: "Employment",
  BIOGRAPHY: "Biography",
  LOCATION: "Location",
  ARREST_OR_COURT_RECORD: "Arrest / court record",
};

export const IDENTIFIER_LABEL: Record<string, string> = {
  FULL_NAME: "Name",
  ALIAS: "Previous names",
  EMAIL: "Emails",
  PHONE: "Phone numbers",
  USERNAME: "Usernames",
  DOMAIN: "Domains you own",
  BUSINESS_NAME: "Business names",
  LOCATION: "Cities you've lived in",
  ADDRESS: "Addresses",
  DATE_OF_BIRTH: "Date of birth",
};

export const PATHWAY: Record<string, string> = {
  GENERAL_PRIVACY_OPT_OUT: "General privacy opt-out",
  DATA_BROKER_OPT_OUT: "Data-broker opt-out",
  SEARCH_RESULT_PRIVACY_REMOVAL: "Search-result privacy removal",
  OUTDATED_CONTENT: "Outdated content",
  COPYRIGHT: "Copyright",
  IMPERSONATION: "Impersonation",
  PERSONAL_INFORMATION_EXPOSURE: "Personal information exposure",
  USER_CONTROLLED_WEBSITE: "Your website",
  PLATFORM_PRIVACY_REQUEST: "Platform privacy request",
  JURISDICTIONAL_DELETION_REQUEST: "Regional deletion request",
  MUGSHOT_REMOVAL: "Mugshot site removal",
  NEWS_UPDATE_REQUEST: "Ask the publisher to update",
  RECORD_SEALING: "Record sealing / expungement (through the court)",
};

export const CASE_OUTCOMES: Array<{ id: string; label: string }> = [
  { id: "NONE", label: "Not applicable" },
  { id: "PENDING", label: "Case still pending" },
  { id: "NOT_CHARGED", label: "Arrested but never charged" },
  { id: "DISMISSED", label: "Charges dropped / dismissed" },
  { id: "ACQUITTED", label: "Found not guilty" },
  { id: "EXPUNGED_OR_SEALED", label: "Record expunged or sealed" },
  { id: "CONVICTED", label: "Convicted" },
];

export const TOPICS: Array<{ id: string; label: string }> = [
  { id: "ARREST", label: "Arrest & mugshots" },
  { id: "COURT", label: "Court records" },
  { id: "COMPLAINTS", label: "Complaints & reviews" },
  { id: "NEWS", label: "News mentions" },
];

export const AUTOMATION: Record<string, { label: string; tone: Tone }> = {
  AUTOMATED: { label: "Automated", tone: "green" },
  SEMI_AUTOMATED: { label: "Semi-automated", tone: "blue" },
  USER_ACTION_REQUIRED: { label: "You submit, we verify", tone: "amber" },
  MANUAL_REVIEW: { label: "Manual review", tone: "gray" },
  UNSUPPORTED: { label: "Unsupported", tone: "gray" },
};

export const BAND: Record<string, { label: string; tone: Tone }> = {
  VERY_STRONG: { label: "Very strong match", tone: "green" },
  STRONG: { label: "Strong match", tone: "green" },
  POSSIBLE: { label: "Possible match", tone: "amber" },
  WEAK: { label: "Weak match", tone: "amber" },
  UNRELATED: { label: "Probably unrelated", tone: "gray" },
};

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtRelative(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
