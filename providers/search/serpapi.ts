import { SearchProviderError, type SearchProvider, type SearchResult } from "./types";

/**
 * SerpApi (https://serpapi.com): an authorized API that returns Google's
 * organic results as JSON. Records are tagged engine "google" so Google's
 * official removal tools and search re-checks apply to them.
 */
export class SerpApiProvider implements SearchProvider {
  readonly id = "google";
  readonly engineName = "Google";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, opts: { count?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(20, opts.count ?? 20)));
    url.searchParams.set("api_key", this.apiKey);
    const res = await this.fetchImpl(url, { signal: opts.signal ?? AbortSignal.timeout(20_000) });
    if (res.status === 429) throw new SearchProviderError("serpapi", "rate limited or monthly quota used up", true);
    if (res.status === 401 || res.status === 403) throw new SearchProviderError("serpapi", "API key rejected", false);
    if (!res.ok) throw new SearchProviderError("serpapi", `HTTP ${res.status}`, res.status >= 500);
    const data = (await res.json()) as { error?: string; organic_results?: Array<{ position?: number; link: string; title: string; snippet?: string }> };
    if (data.error && !/hasn't returned any results/i.test(data.error)) throw new SearchProviderError("serpapi", data.error, false);
    return (data.organic_results ?? []).map((r, i) => ({ url: r.link, title: r.title, snippet: r.snippet ?? "", rank: r.position ?? i + 1 }));
  }
}
