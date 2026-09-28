import { SearchProviderError, type SearchProvider, type SearchResult } from "./types";

/** Brave Search API (https://api.search.brave.com) — authorized web search API. */
export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave";
  readonly engineName = "Brave Search";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, opts: { count?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(20, opts.count ?? 20)));
    url.searchParams.set("safesearch", "moderate");
    const res = await this.fetchImpl(url, {
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
      signal: opts.signal ?? AbortSignal.timeout(10_000),
    });
    if (res.status === 429) throw new SearchProviderError(this.id, "rate limited", true);
    if (!res.ok) throw new SearchProviderError(this.id, `HTTP ${res.status}`, res.status >= 500);
    const data = (await res.json()) as { web?: { results?: Array<{ url: string; title: string; description?: string }> } };
    return (data.web?.results ?? []).map((r, i) => ({ url: r.url, title: r.title, snippet: stripTags(r.description ?? ""), rank: i + 1 }));
  }
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
