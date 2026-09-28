import type { DataType } from "../shared/domain";
import { dataTypesFor, extractAttributes, htmlToText } from "../core/extract";
import { MATCH_THRESHOLDS, scoreMatch } from "../core/matching";
import type { SubjectProfile } from "../core/subject";
import { UnsafeUrlError } from "../security/ssrf";
import { detectHumanVerification, type HttpClient } from "./engine/browser";
import type { VerificationResult } from "./types";

const SENSITIVE: DataType[] = ["HOME_ADDRESS", "PHONE", "EMAIL", "AGE_OR_DOB", "RELATIVES"];

/**
 * Generic page-level verification.
 *
 *  - 404/410                          → REMOVED_FROM_SOURCE (the page is gone)
 *  - page loads, subject not detected → NO_LONGER_DETECTED (weaker claim!)
 *  - page loads, fewer sensitive data → PARTIALLY_REMOVED
 *  - page loads, subject still there  → STILL_PRESENT
 *  - blocked / challenge / error      → INCONCLUSIVE (never bypassed)
 */
export async function verifyPage(
  http: HttpClient,
  url: string,
  subject: SubjectProfile,
  previousDataTypes: DataType[],
): Promise<VerificationResult> {
  let res;
  try {
    res = await http.request(url);
  } catch (err) {
    return {
      found: null,
      outcome: "INCONCLUSIVE",
      method: "PAGE_CHECK",
      details: { reason: err instanceof UnsafeUrlError ? "url_rejected" : "fetch_failed" },
    };
  }
  if (res.status === 404 || res.status === 410) {
    return { found: false, outcome: "REMOVED_FROM_SOURCE", method: "PAGE_CHECK", details: { httpStatus: res.status } };
  }
  if (res.status >= 400 || detectHumanVerification(res)) {
    return { found: null, outcome: "INCONCLUSIVE", method: "PAGE_CHECK", details: { httpStatus: res.status, reason: "unavailable_or_challenge" } };
  }
  const text = htmlToText(res.body);
  const attrs = extractAttributes(text, subject, { url, html: res.body });
  const match = scoreMatch(subject, attrs, { url });
  const noindex = /noindex/i.test(res.headers["x-robots-tag"] ?? "") || /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(res.body);
  if (match.confidence < MATCH_THRESHOLDS.WEAK) {
    return { found: false, outcome: "NO_LONGER_DETECTED", method: "PAGE_CHECK", details: { httpStatus: res.status, noindex } };
  }
  const now = dataTypesFor(attrs).filter((t) => SENSITIVE.includes(t));
  const before = previousDataTypes.filter((t) => SENSITIVE.includes(t));
  if (before.length > 0 && now.length < before.length) {
    return {
      found: true,
      outcome: "PARTIALLY_REMOVED",
      method: "PAGE_CHECK",
      details: { httpStatus: res.status, removedTypes: before.filter((t) => !now.includes(t)), noindex },
    };
  }
  return { found: true, outcome: "STILL_PRESENT", method: "PAGE_CHECK", details: { httpStatus: res.status, confidence: match.confidence, noindex } };
}
