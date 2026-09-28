import type { SubjectProfile } from "./subject";
import { focusTerms, type SearchFocus } from "./topics";

/**
 * Controlled search-query expansion (spec §33).
 *
 * - Only the subject's own identifiers are used; no speculative variations
 *   that would surface unrelated people's data.
 * - Date of birth and street addresses are never sent to search providers.
 * - Output is capped to keep API usage and data exposure bounded.
 */
export interface SearchQuery {
  q: string;
  /** Which identifier kinds contributed, for precision weighting. */
  basis: Array<"name" | "location" | "email" | "phone" | "username" | "domain" | "business" | "topic">;
}

export const MAX_QUERIES = 30;

export function expandQueries(s: SubjectProfile, max = MAX_QUERIES, focus?: SearchFocus): SearchQuery[] {
  const out: SearchQuery[] = [];
  const add = (q: string, basis: SearchQuery["basis"]) => {
    if (!out.some((x) => x.q === q)) out.push({ q, basis });
  };
  const names = [...s.names, ...s.previousNames].slice(0, 3);
  // Focused topics come first so they survive the query cap. Always anchored to the subject's name.
  if (focus) {
    const terms = focusTerms(focus);
    const city = s.locations.find((l) => l.city)?.city;
    for (const n of names.slice(0, 2)) {
      for (const t of terms) add(`"${n}" ${t}`, ["name", "topic"]);
      if (city && terms[0]) add(`"${n}" "${titleCase(city)}" ${terms[0]}`, ["name", "location", "topic"]);
    }
  }
  for (const n of names) {
    add(`"${n}"`, ["name"]);
    for (const suffix of ["address", "phone", "email"]) add(`"${n}" ${suffix}`, ["name"]);
    for (const loc of s.locations.slice(0, 3)) {
      if (loc.city) add(`"${n}" "${titleCase(loc.city)}"${loc.region ? ` ${loc.region.toUpperCase()}` : ""}`, ["name", "location"]);
    }
    for (const u of s.usernames.slice(0, 2)) add(`"${n}" "${u}"`, ["name", "username"]);
  }
  for (const e of s.emails.slice(0, 5)) add(`"${e}"`, ["email"]);
  for (const p of s.phones.slice(0, 3)) {
    const d = p.replace(/\D/g, "").slice(-10);
    if (d.length === 10) {
      add(`"${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}"`, ["phone"]);
      add(`"(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}"`, ["phone"]);
    } else add(`"${p}"`, ["phone"]);
  }
  for (const u of s.usernames.slice(0, 5)) add(`"${u}"`, ["username"]);
  for (const b of s.businessNames.slice(0, 2)) add(`"${b}"`, ["business"]);
  return out.slice(0, max);
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
