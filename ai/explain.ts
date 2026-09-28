import type { RecordStatus, VerificationOutcome } from "../shared/domain";

/**
 * Plain-language explanations of lifecycle states. Deterministic by design:
 * the user must be told exactly what happened, so these are not generated.
 */
export const STATUS_EXPLANATIONS: Record<RecordStatus, string> = {
  DISCOVERED: "We found this listing and are preparing next steps.",
  NEEDS_REVIEW: "We're not sure this is you. Please confirm or dismiss it before we take any action.",
  READY: "A removal request can be prepared for this listing.",
  AWAITING_APPROVAL: "A removal request is ready. Review and approve it to submit.",
  SUBMITTED: "The removal request was submitted to the provider.",
  AWAITING_VERIFICATION: "The request was submitted. We'll re-check the source after the provider's usual processing time.",
  REMOVED: "We verified that this listing is no longer available at the source. We'll keep monitoring for reappearance.",
  PARTIALLY_REMOVED: "Some of your information was removed, but part of the listing is still visible.",
  FAILED: "The removal attempt did not succeed. See the details for what happened and what you can do next.",
  REQUIRES_USER_ACTION: "This provider needs you to complete a step we can't do for you.",
  REAPPEARED: "A listing we previously verified as removed has been detected again.",
  NO_ACTION_AVAILABLE: "There is no legitimate removal process available for this result.",
  DISMISSED: "You marked this result as not about you. No action will be taken.",
};

export const OUTCOME_EXPLANATIONS: Record<VerificationOutcome, string> = {
  STILL_PRESENT: "The listing is still live.",
  REMOVED_FROM_SOURCE: "Removed from source: the page itself is gone from the website.",
  REMOVED_FROM_SEARCH_RESULTS: "Removed from search results: the search engine no longer shows it. The original page may still exist.",
  NO_LONGER_DETECTED: "No longer detected: the page loads but we no longer find your information on it. This is weaker than confirmed removal.",
  PARTIALLY_REMOVED: "Partially removed: some personal details are gone, others remain.",
  INCONCLUSIVE: "We couldn't check automatically (for example the site required human verification). We'll try again.",
};
