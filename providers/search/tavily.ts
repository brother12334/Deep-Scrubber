import { SearchProviderError, type SearchProvider, type SearchResult } from "./types";

/** Tavily search API (https://tavily.com): authorized web search returning JSON results. */
export class TavilyProvider implements SearchProvider {
  readonly id = "tavily";
  readonly engineName = "Tavily";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, opts: { count?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const res = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: Math.min(20, opts.count ?? 20), search_depth: "basic" }),
      signal: opts.signal ?? AbortSignal.timeout(20_000),
    });
    if (res.status === 429 || res.status === 432) throw new SearchProviderError("tavily", "rate limited or plan limit reached", true);
    if (res.status === 401 || res.status === 403) throw new SearchProviderError("tavily", "API key rejected", false);
    if (!res.ok) throw new SearchProviderError("tavily", `HTTP ${res.status}`, res.status >= 500);
    const data = (await res.json()) as { results?: Array<{ url: string; title: string; content?: string }> };
    return (data.results ?? []).map((r, i) => ({ url: r.url, title: r.title, snippet: r.content ?? "", rank: i + 1 }));
  }
}
