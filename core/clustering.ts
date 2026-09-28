import { createHash } from "node:crypto";
import type { CandidateAttributes } from "./extract";
import type { SubjectProfile } from "./subject";
import { canonicalUrl } from "./normalize";

/**
 * Duplicate detection / exposure clustering (spec §34).
 *
 * A cluster represents one underlying record of the subject's data that may
 * surface in several places: the originating broker page, mirror sites run by
 * the same operator, and appearances in multiple search engines.
 *
 * The fingerprint only hashes *which of the subject's identifiers* are
 * present — never raw page content — so it is safe to store.
 */
export function clusterFingerprint(params: {
  sourceFamily: string;
  subject: SubjectProfile;
  attributes: CandidateAttributes;
}): string {
  const { subject, attributes: a } = params;
  const matched = [
    ...a.emails.filter((e) => subject.emails.includes(e)).map((e) => `e:${e}`),
    ...a.phones.filter((p) => subject.phones.includes(p)).map((p) => `p:${p}`),
    ...a.usernames.filter((u) => subject.usernames.includes(u)).map((u) => `u:${u}`),
    ...a.names.map((n) => `n:${n}`),
    a.hasStreetAddress ? "addr" : "",
  ]
    .filter(Boolean)
    .sort();
  return createHash("sha256").update(`${params.sourceFamily}|${matched.join("|")}`).digest("hex").slice(0, 32);
}

/** Search appearances cluster with the page they point at. */
export function searchAppearanceKey(url: string): string {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 32);
}

export interface ClusterMember {
  id: string;
  sourceId: string | null;
  isSearchResult: boolean;
  parentRecordId: string | null;
  searchEngine: string | null;
  title?: string | null;
}

export interface ClusterSummary {
  originRecordId: string | null;
  searchAppearances: Record<string, number>;
  mirrors: string[];
  recommendedAction: string;
}

export function summarizeCluster(members: ClusterMember[], sourceNames: Map<string, string>): ClusterSummary {
  const origins = members.filter((m) => !m.isSearchResult && !m.parentRecordId);
  const origin = origins.find((m) => m.sourceId) ?? origins[0] ?? null;
  const searchAppearances: Record<string, number> = {};
  for (const m of members.filter((x) => x.isSearchResult)) {
    const k = m.searchEngine ?? "Other indexes";
    searchAppearances[k] = (searchAppearances[k] ?? 0) + 1;
  }
  const mirrors = members.filter((m) => !m.isSearchResult && m !== origin).map((m) => m.sourceId ?? "unknown");
  // A mirror may appear several times (different pages); list each source once.
  mirrors.splice(0, mirrors.length, ...new Set(mirrors));
  const originName = origin?.sourceId ? sourceNames.get(origin.sourceId) ?? origin.sourceId : "the original page";
  return {
    originRecordId: origin?.id ?? null,
    searchAppearances,
    mirrors,
    recommendedAction: origin
      ? `Remove from ${originName} first. Search appearances are re-checked automatically once the source is gone.`
      : "Review the search appearances; the original page could not be identified.",
  };
}
