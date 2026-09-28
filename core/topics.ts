/**
 * Focused searches: look for the subject's name together with a topic such as
 * an arrest. Topics are a fixed list; users may add a few short custom terms.
 * Queries always include the subject's own name, so this can't be used to
 * search a topic in general.
 */
export const SEARCH_TOPICS = {
  ARREST: { label: "Arrest & mugshots", terms: ["arrest", "arrested", "mugshot", "booking", "charged"] },
  COURT: { label: "Court records", terms: ["court", "case", "lawsuit", "sentenced"] },
  COMPLAINTS: { label: "Complaints & reviews", terms: ["complaint", "scam", "reviews"] },
  NEWS: { label: "News mentions", terms: ["news"] },
} as const;
export type SearchTopic = keyof typeof SEARCH_TOPICS;

export const MAX_CUSTOM_TERMS = 3;
const TERM_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&.-]{1,29}$/u;

export interface SearchFocus {
  topics: SearchTopic[];
  customTerms: string[];
}

export function validateFocus(input: { topics?: unknown; customTerms?: unknown }): SearchFocus {
  const topics = Array.isArray(input.topics) ? input.topics.filter((t): t is SearchTopic => typeof t === "string" && t in SEARCH_TOPICS) : [];
  const custom = Array.isArray(input.customTerms) ? input.customTerms : [];
  const customTerms: string[] = [];
  for (const raw of custom) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (!TERM_RE.test(t)) throw new Error(`"${t.slice(0, 40)}" isn't a valid search term (letters and numbers, 2–30 characters).`);
    if (!customTerms.includes(t.toLowerCase())) customTerms.push(t.toLowerCase());
  }
  if (customTerms.length > MAX_CUSTOM_TERMS) throw new Error(`Use at most ${MAX_CUSTOM_TERMS} custom terms.`);
  return { topics: [...new Set(topics)], customTerms };
}

/** Flat list of terms for a focus, most specific first. */
export function focusTerms(f: SearchFocus): string[] {
  return [...new Set([...f.customTerms, ...f.topics.flatMap((t) => SEARCH_TOPICS[t].terms)])];
}
