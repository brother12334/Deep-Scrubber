import { SearchProviderError, type SearchProvider, type SearchResult } from "./types";

/** Google Programmable Search Engine JSON API (Custom Search). */
export class GoogleCseProvider implements SearchProvider {
  readonly id = "google";
  readonly engineName = "Google";

  constructor(
    private readonly apiKey: string,
    private readonly cx: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, opts: { count?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.cx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(10, opts.count ?? 10)));
    const res = await this.fetchImpl(url, { signal: opts.signal ?? AbortSignal.timeout(10_000) });
    if (res.status === 429) throw new SearchProviderError(this.id, "quota exceeded", true);
    if (!res.ok) throw new SearchProviderError(this.id, `HTTP ${res.status}`, res.status >= 500);
    const data = (await res.json()) as { items?: Array<{ link: string; title: string; snippet?: string }> };
    return (data.items ?? []).map((r, i) => ({ url: r.link, title: r.title, snippet: r.snippet ?? "", rank: i + 1 }));
  }
}
