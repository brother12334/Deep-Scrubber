import { readFileSync } from "node:fs";
import type { SearchProvider, SearchResult } from "./types";

/**
 * Deterministic provider for development, demos and tests. Returns canned
 * results whose query contains a fixture key (case-insensitive).
 */
export interface FixtureEntry {
  match: string;
  results: Array<Omit<SearchResult, "rank">>;
}

export class FixtureSearchProvider implements SearchProvider {
  readonly engineName: string;
  queries: string[] = [];

  constructor(
    private readonly entries: FixtureEntry[],
    readonly id = "fixture",
    engineName = "Fixture Search",
  ) {
    this.engineName = engineName;
  }

  static fromFile(path: string, id?: string): FixtureSearchProvider {
    return new FixtureSearchProvider(JSON.parse(readFileSync(path, "utf8")) as FixtureEntry[], id);
  }

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    const q = query.toLowerCase();
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const e of this.entries) {
      if (!q.includes(e.match.toLowerCase())) continue;
      for (const r of e.results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({ ...r, rank: out.length + 1 });
      }
    }
    return out;
  }

  /** Test helper: stop returning a URL (simulates de-indexing). */
  removeUrl(url: string): void {
    for (const e of this.entries) e.results = e.results.filter((r) => r.url !== url);
  }
}
