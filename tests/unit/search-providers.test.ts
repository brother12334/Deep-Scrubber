import { describe, expect, it } from "vitest";
import { createSearchProviders } from "../../providers/search";
import { SerpApiProvider } from "../../providers/search/serpapi";
import { TavilyProvider } from "../../providers/search/tavily";
import { loadConfig } from "../../shared/config";

const fakeFetch = (status: number, body: unknown, seen: Array<{ url: string; init?: RequestInit }> = []) =>
  (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("SerpApi provider", () => {
  it("maps Google organic results and tags them as Google", async () => {
    const seen: Array<{ url: string }> = [];
    const p = new SerpApiProvider("k", fakeFetch(200, { organic_results: [{ position: 1, link: "https://a.test/x", title: "A", snippet: "s" }] }, seen));
    expect(p.id).toBe("google");
    expect(await p.search('"Jane Doe"')).toEqual([{ url: "https://a.test/x", title: "A", snippet: "s", rank: 1 }]);
    const u = new URL(seen[0]!.url);
    expect(u.host).toBe("serpapi.com");
    expect(u.searchParams.get("engine")).toBe("google");
    expect(u.searchParams.get("q")).toBe('"Jane Doe"');
  });
  it("treats 'no results' as empty and bad keys as non-retryable errors", async () => {
    expect(await new SerpApiProvider("k", fakeFetch(200, { error: "Google hasn't returned any results for this query." })).search("q")).toEqual([]);
    await expect(new SerpApiProvider("k", fakeFetch(401, {})).search("q")).rejects.toMatchObject({ retryable: false });
    await expect(new SerpApiProvider("k", fakeFetch(429, {})).search("q")).rejects.toMatchObject({ retryable: true });
  });
});

describe("Tavily provider", () => {
  it("posts the query with a bearer token and maps results", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const p = new TavilyProvider("tvly-x", fakeFetch(200, { results: [{ url: "https://b.test", title: "B", content: "c" }] }, seen));
    expect(await p.search("q")).toEqual([{ url: "https://b.test", title: "B", snippet: "c", rank: 1 }]);
    expect(seen[0]!.url).toBe("https://api.tavily.com/search");
    expect((seen[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tvly-x");
  });
});

describe("provider factory", () => {
  it("reports providers that are listed but missing a key", () => {
    const skipped: string[] = [];
    const cfg = { ...loadConfig(process.env), SEARCH_PROVIDERS: "serpapi,tavily,brave", SERPAPI_API_KEY: "k" };
    const ps = createSearchProviders(cfg, (id) => skipped.push(id));
    expect(ps.map((p) => p.engineName)).toEqual(["Google"]);
    expect(skipped).toEqual(["tavily", "brave"]);
  });
});
