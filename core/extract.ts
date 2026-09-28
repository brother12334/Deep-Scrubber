import type { DataType } from "../shared/domain";
import { normalizeEmail, normalizePhone, normalizeName, normalizeUsername, US_STATES } from "./normalize";
import type { SubjectProfile } from "./subject";
import { allNames } from "./subject";

/**
 * Deterministic attribute extraction from a public page or search snippet.
 * Output feeds the identity matcher. AI classification may enrich this, but
 * never replaces it.
 */
export interface CandidateAttributes {
  /** Names found that plausibly refer to the subject (only subject names are searched for). */
  names: string[];
  emails: string[];
  phones: string[];
  usernames: string[];
  /** "city,st" pairs. */
  locations: string[];
  /** Subject's cities mentioned without a recognisable state next to them. */
  cityMentions: string[];
  hasStreetAddress: boolean;
  ages: number[];
  mentionsRelatives: boolean;
  hasPhoto: boolean;
  mentionsEmployment: boolean;
  /** Mentions an arrest, charges, booking or a court case. */
  mentionsCriminalRecord?: boolean;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const CITY_STATE_RE = /\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2}),\s?([A-Z]{2})\b/g;
const STATE_NAMES = Object.keys(US_STATES).sort((a, b) => b.length - a.length);
// "Boca Raton, Florida" / "Boca Raton, New York" — full state names.
const CITY_STATE_NAME_RE = new RegExp(
  `\\b([A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+){0,2}),\\s?(${STATE_NAMES.map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())).join("|")})\\b`,
  "g",
);
const STREET_RE =
  /\b\d{1,6}\s+(?:[A-Z0-9][a-zA-Z0-9]*\s){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway)\b\.?/;
const AGE_RE = /\b(?:age|aged)\s*:?\s*(\d{2})\b|\b(\d{2})\s*(?:years old|yrs old)\b/gi;
const USERNAME_RE = /(?:^|\s)@([a-z0-9_.]{2,30})\b/gi;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAttributes(text: string, subject: SubjectProfile, opts: { url?: string; html?: string } = {}): CandidateAttributes {
  const lowered = normalizeName(text);
  const names = allNames(subject).filter((n) => containsName(lowered, n));

  const emails = uniq([...text.matchAll(EMAIL_RE)].map((m) => normalizeEmail(m[0])));
  const phones = uniq([...text.matchAll(PHONE_RE)].map((m) => normalizePhone(`${m[1]}${m[2]}${m[3]}`)));
  const locations = uniq([
    ...[...text.matchAll(CITY_STATE_RE)].map((m) => `${m[1]!.toLowerCase()},${m[2]!.toLowerCase()}`),
    ...[...text.matchAll(CITY_STATE_NAME_RE)].map((m) => `${m[1]!.toLowerCase()},${US_STATES[m[2]!.toLowerCase()]}`),
  ]);
  // The subject's own cities, mentioned anywhere (news often says "Boca Raton police" with no state).
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  const cityMentions: string[] = [];
  for (const loc of subject.locations) {
    if (!loc.city || loc.city.length < 3) continue;
    const key = `${loc.city},${loc.region ?? ""}`;
    if (locations.includes(key)) continue;
    if (!lower.includes(` ${loc.city} `)) continue;
    const stateName = Object.entries(US_STATES).find(([, code]) => code === loc.region)?.[0];
    const statePresent = !!loc.region && (lower.includes(` ${stateName} `) || new RegExp(`\\b${loc.region.toUpperCase()}\\b`).test(text));
    if (statePresent) locations.push(key);
    else cityMentions.push(loc.city);
  }
  const ages = uniq([...text.matchAll(AGE_RE)].map((m) => Number(m[1] ?? m[2]))).filter((a) => a >= 18 && a <= 110);
  const usernames = new Set([...text.matchAll(USERNAME_RE)].map((m) => normalizeUsername(m[1]!)));
  // A subject username in the URL path is strong evidence of a profile page.
  if (opts.url) {
    try {
      const segments = new URL(opts.url).pathname.split("/").map((s) => normalizeUsername(decodeURIComponent(s)));
      for (const u of subject.usernames) if (segments.includes(u)) usernames.add(u);
    } catch {
      /* ignore bad URLs */
    }
  }
  for (const u of subject.usernames) if (new RegExp(`\\b${escapeRe(u)}\\b`, "i").test(text)) usernames.add(u);

  return {
    names,
    emails,
    phones,
    usernames: [...usernames],
    locations,
    cityMentions: uniq(cityMentions),
    hasStreetAddress: STREET_RE.test(text),
    ages,
    mentionsRelatives: /\b(relatives|related to|family members|associated people|possible relatives)\b/i.test(text),
    hasPhoto: opts.html ? /<img[^>]+(profile|avatar|photo)/i.test(opts.html) : false,
    mentionsEmployment: /\b(works at|employer|employed at|occupation|job title)\b/i.test(text),
    mentionsCriminalRecord: /\b(arrest(ed|s)?|mugshots?|booking (photo|date)|charged with|inmate|jail|sentenced|convicted|indicted|indictment|probation|court records?|docket)\b/i.test(text),
  };
}

export function dataTypesFor(a: CandidateAttributes): DataType[] {
  const t = new Set<DataType>();
  if (a.names.length) t.add("NAME");
  if (a.hasStreetAddress) t.add("HOME_ADDRESS");
  if (a.phones.length) t.add("PHONE");
  if (a.emails.length) t.add("EMAIL");
  if (a.ages.length) t.add("AGE_OR_DOB");
  if (a.mentionsRelatives) t.add("RELATIVES");
  if (a.usernames.length) t.add("USERNAME");
  if (a.hasPhoto) t.add("PHOTO");
  if (a.mentionsEmployment) t.add("EMPLOYMENT");
  if (a.locations.length || a.cityMentions?.length) t.add("LOCATION");
  if (a.mentionsCriminalRecord) t.add("ARREST_OR_COURT_RECORD");
  return [...t];
}

function containsName(haystack: string, name: string): boolean {
  if (!name) return false;
  if (haystack.includes(name)) return true;
  // Allow a middle name/initial between first and last.
  const parts = name.split(" ");
  if (parts.length < 2) return false;
  const first = escapeRe(parts[0]!);
  const last = escapeRe(parts[parts.length - 1]!);
  return new RegExp(`\\b${first}\\s+(?:[a-z]\\.?\\s+|[a-z]+\\s+)?${last}\\b`).test(haystack);
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
