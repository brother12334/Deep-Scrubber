import type { ExposureCategory } from "../shared/domain";
import { domainOf } from "./normalize";

/**
 * Deterministic result classifier. The AI layer may propose a category, but
 * this function is the authority when a registry entry or strong rule applies.
 */

export interface RegistryLookup {
  byDomain(domain: string): { id: string; categories: string[] } | undefined;
  byId?(id: string): { id: string; categories: string[] } | undefined;
}

const SOCIAL = ["facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "pinterest.com", "threads.net", "mastodon.social", "bsky.app", "youtube.com"];
const PROFESSIONAL = ["linkedin.com", "github.com", "gitlab.com", "crunchbase.com", "angel.co", "wellfound.com", "behance.net", "dribbble.com"];
const NEWS_HINTS = /\b(news|times|post|herald|tribune|gazette|journal|chronicle|press)\b/;
const SEARCH_ENGINES = ["google.com", "bing.com", "duckduckgo.com", "search.brave.com", "yahoo.com"];

export interface Classification {
  category: ExposureCategory;
  sourceId?: string;
  /** Lawful public-interest content (news, court coverage…): shown but not pushed for removal. */
  publicInterest: boolean;
  reason: string;
}

export function classifyResult(
  url: string,
  text: string,
  registry: RegistryLookup,
  userDomains: string[] = [],
  knownSourceId?: string,
): Classification {
  const domain = domainOf(url);
  const known = knownSourceId ? registry.byId?.(knownSourceId) : undefined;
  if (known) {
    return { category: (known.categories[0] ?? "OTHER") as ExposureCategory, sourceId: known.id, publicInterest: false, reason: "Found through the source's own search" };
  }
  if (userDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "USER_CONTROLLED", publicInterest: false, reason: "Domain is listed as owned by you" };
  }
  const src = lookupWithParents(domain, registry);
  if (src) {
    const cat = (src.categories[0] ?? "OTHER") as ExposureCategory;
    return { category: cat, sourceId: src.id, publicInterest: false, reason: "Known source in the registry" };
  }
  if (SEARCH_ENGINES.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "SEARCH_RESULT", publicInterest: false, reason: "Search engine page" };
  }
  if (SOCIAL.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "SOCIAL", publicInterest: false, reason: "Social platform" };
  }
  if (PROFESSIONAL.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { category: "PROFESSIONAL", publicInterest: false, reason: "Professional platform" };
  }
  const t = text.toLowerCase();
  // Mugshot / arrest-record aggregators (not official sources, not journalism).
  if (/(mugshot|booking photo|arrest records?|inmate search|jail roster|busted)/.test(`${domain} ${t}`) && !isGov(domain) && !NEWS_HINTS.test(domain)) {
    return { category: "MUGSHOT_OR_ARREST_RECORD", publicInterest: false, reason: "Looks like a mugshot or arrest-record site" };
  }
  // Court records: official court sites are public records; aggregators are not.
  if (/(court ?records?|case number|docket|plaintiff|defendant|case summary)/.test(t) || /court/.test(domain)) {
    return isGov(domain)
      ? { category: "COURT_RECORD", publicInterest: true, reason: "Official court record; changes happen through the court (e.g. sealing)" }
      : { category: "COURT_RECORD", publicInterest: false, reason: "Looks like a court-record aggregator" };
  }
  if (/(people search|background check|public records|find anyone|reverse phone|people finder|lookup anyone)/.test(t)) {
    return { category: "PEOPLE_SEARCH", publicInterest: false, reason: "Page looks like a people-search listing" };
  }
  if (/(directory|yellow pages|white pages|listings)/.test(t)) {
    return { category: "DIRECTORY", publicInterest: false, reason: "Page looks like a directory listing" };
  }
  if (
    NEWS_HINTS.test(domain) ||
    domain.split(".")[0]!.includes("news") ||
    /\b(reported|according to|court|verdict|press release|police said|sheriff'?s office said|was arrested|were arrested)\b/.test(t)
  ) {
    return {
      category: "NEWS_OR_PUBLIC_INTEREST",
      publicInterest: true,
      reason: "Looks like news or public-interest reporting; removal is generally not appropriate",
    };
  }
  return { category: "OTHER", publicInterest: false, reason: "No specific classification" };
}

function isGov(domain: string): boolean {
  return /\.(gov|mil)$/.test(domain) || /\.(state|courts?)\.[a-z]{2}\.us$/.test(domain) || /\.us$/.test(domain) && /court|clerk/.test(domain);
}

function lookupWithParents(domain: string, registry: RegistryLookup) {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = registry.byDomain(parts.slice(i).join("."));
    if (hit) return hit;
  }
  return undefined;
}
