import type { DataType } from "../../shared/domain";
import { classifyResult, type Classification, type RegistryLookup } from "../../core/classification";
import { dataTypesFor, extractAttributes, htmlToText, type CandidateAttributes } from "../../core/extract";
import { RETAIN_MIN_CONFIDENCE, scoreMatch, type MatchResult } from "../../core/matching";
import { canonicalUrl, domainOf } from "../../core/normalize";
import { expandQueries } from "../../core/queries";
import type { SubjectProfile } from "../../core/subject";
import type { HttpClient } from "../../removal-agents/engine/browser";
import { detectHumanVerification } from "../../removal-agents/engine/browser";
import type { AgentContext, DiscoveredCandidate, RemovalAgent } from "../../removal-agents/types";
import type { SearchProvider } from "../search/types";

/**
 * Modular discovery engine (spec §4):
 *   1. Site-specific discovery through each supporting agent (public search pages).
 *   2. Controlled query expansion across all configured search APIs.
 *   3. Optional fetch of result pages (SSRF-safe, crawl-limited) to improve matching.
 *   4. Identity matching, classification and grouping of search appearances.
 *
 * Results below the retention threshold are discarded, never stored: they are
 * most likely about someone else.
 */

export interface SearchAppearance {
  engine: string;
  engineName: string;
  rank: number;
  query: string;
}

export interface DiscoveryHit {
  url: string;
  canonical: string;
  title?: string;
  snippet: string;
  discoveryMethod: DiscoveredCandidate["discoveryMethod"];
  sourceId?: string;
  classification: Classification;
  attributes: CandidateAttributes;
  dataTypes: DataType[];
  match: MatchResult;
  searchAppearances: SearchAppearance[];
}

export interface DiscoveryStats {
  queries: number;
  providerErrors: number;
  rawResults: number;
  pagesFetched: number;
  discardedLowConfidence: number;
  retained: number;
  siteSearches: number;
  /** Which search engines were queried ("fixture" = demo data, not the real web). */
  searchProviders: string[];
}

export interface DiscoveryDeps {
  providers: SearchProvider[];
  registry: RegistryLookup;
  http?: HttpClient;
  /** Agents that support SITE_SEARCH, with their contexts. */
  siteAgents: Array<{ agent: RemovalAgent; ctx: AgentContext }>;
  maxPageFetches?: number;
  maxQueries?: number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export async function runDiscovery(subject: SubjectProfile, deps: DiscoveryDeps): Promise<{ hits: DiscoveryHit[]; stats: DiscoveryStats }> {
  const stats: DiscoveryStats = { queries: 0, providerErrors: 0, rawResults: 0, pagesFetched: 0, discardedLowConfidence: 0, retained: 0, siteSearches: 0, searchProviders: deps.providers.map((p) => p.id) };
  const byUrl = new Map<string, DiscoveryHit>();

  // 1. Site-specific discovery.
  for (const { agent, ctx } of deps.siteAgents) {
    try {
      const candidates = await agent.discover(ctx, subject);
      stats.siteSearches++;
      for (const c of candidates) {
        const m = agent.identifyMatch(subject, c);
        consider(c, m.attributes, m, []);
      }
    } catch (err) {
      stats.providerErrors++;
      deps.log?.("site discovery failed", { agent: agent.key, error: String(err) });
    }
  }

  // 2. Search APIs.
  const queries = expandQueries(subject, deps.maxQueries);
  const pending = new Map<string, { title: string; snippet: string; appearances: SearchAppearance[] }>();
  for (const provider of deps.providers) {
    for (const q of queries) {
      stats.queries++;
      try {
        const results = await provider.search(q.q);
        stats.rawResults += results.length;
        for (const r of results) {
          const key = canonicalUrl(r.url);
          const entry = pending.get(key) ?? { title: r.title, snippet: r.snippet, appearances: [] };
          if (!entry.snippet.includes(r.snippet)) entry.snippet = `${entry.snippet} ${r.snippet}`.trim();
          if (!entry.appearances.some((a) => a.engine === provider.id)) {
            entry.appearances.push({ engine: provider.id, engineName: provider.engineName, rank: r.rank, query: q.q });
          } else {
            const a = entry.appearances.find((x) => x.engine === provider.id)!;
            a.rank = Math.min(a.rank, r.rank);
          }
          pending.set(key, entry);
        }
      } catch (err) {
        stats.providerErrors++;
        deps.log?.("search provider failed", { provider: provider.id, error: String(err) });
      }
    }
  }

  // 3. Optionally fetch pages to improve precision (bounded).
  let fetchBudget = deps.maxPageFetches ?? 20;
  for (const [key, entry] of pending) {
    let html: string | undefined;
    if (deps.http && fetchBudget > 0 && !byUrl.has(key)) {
      fetchBudget--;
      try {
        const res = await deps.http.request(key);
        stats.pagesFetched++;
        if (res.status === 200 && !detectHumanVerification(res)) html = res.body;
      } catch {
        /* fall back to snippet-only matching */
      }
    }
    const candidate: DiscoveredCandidate = {
      url: key,
      title: entry.title,
      text: `${entry.title} ${entry.snippet}`,
      html,
      discoveryMethod: "SEARCH_API",
    };
    const text = `${entry.title} ${entry.snippet} ${html ? htmlToText(html) : ""}`;
    const attributes = extractAttributes(text, subject, { url: key, html });
    const match = scoreMatch(subject, attributes, { url: key });
    consider(candidate, attributes, match, entry.appearances);
  }

  function consider(c: DiscoveredCandidate, attributes: CandidateAttributes, match: MatchResult, appearances: SearchAppearance[]) {
    const canonical = canonicalUrl(c.url);
    const existing = byUrl.get(canonical);
    if (existing) {
      for (const a of appearances) if (!existing.searchAppearances.some((x) => x.engine === a.engine)) existing.searchAppearances.push(a);
      if (match.confidence > existing.match.confidence) Object.assign(existing, { match, attributes, dataTypes: dataTypesFor(attributes) });
      return;
    }
    const classification = classifyResult(c.url, c.text + (c.html ? htmlToText(c.html) : ""), deps.registry, subject.domains, c.sourceId);
    if (match.confidence < RETAIN_MIN_CONFIDENCE && classification.category !== "USER_CONTROLLED") {
      stats.discardedLowConfidence++;
      return;
    }
    byUrl.set(canonical, {
      url: c.url,
      canonical,
      title: c.title,
      snippet: c.text.slice(0, 600),
      discoveryMethod: c.discoveryMethod,
      sourceId: c.sourceId ?? classification.sourceId,
      classification,
      attributes,
      dataTypes: dataTypesFor(attributes),
      match,
      searchAppearances: [...appearances],
    });
  }

  const hits = [...byUrl.values()];
  stats.retained = hits.length;
  return { hits, stats };
}

export function hitDomain(hit: DiscoveryHit): string {
  return domainOf(hit.url);
}
