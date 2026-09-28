import type { AppConfig } from "../../shared/config";
import { BraveSearchProvider } from "./brave";
import { FixtureSearchProvider } from "./fixture";
import { GoogleCseProvider } from "./google-cse";
import { SerpApiProvider } from "./serpapi";
import { TavilyProvider } from "./tavily";
import type { SearchProvider } from "./types";

export * from "./types";
export { FixtureSearchProvider } from "./fixture";

/**
 * Build the configured providers. A provider listed in SEARCH_PROVIDERS without
 * its API key is skipped and reported via `onSkip`, so a missing key is visible
 * instead of silently producing empty scans.
 */
export function createSearchProviders(cfg: AppConfig, onSkip: (id: string, reason: string) => void = () => {}): SearchProvider[] {
  const out: SearchProvider[] = [];
  for (const id of cfg.SEARCH_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (id === "brave") {
      if (cfg.BRAVE_SEARCH_API_KEY) out.push(new BraveSearchProvider(cfg.BRAVE_SEARCH_API_KEY));
      else onSkip(id, "BRAVE_SEARCH_API_KEY is not set");
    } else if (id === "serpapi") {
      if (cfg.SERPAPI_API_KEY) out.push(new SerpApiProvider(cfg.SERPAPI_API_KEY));
      else onSkip(id, "SERPAPI_API_KEY is not set");
    } else if (id === "tavily") {
      if (cfg.TAVILY_API_KEY) out.push(new TavilyProvider(cfg.TAVILY_API_KEY));
      else onSkip(id, "TAVILY_API_KEY is not set");
    } else if (id === "google") {
      if (cfg.GOOGLE_CSE_API_KEY && cfg.GOOGLE_CSE_ID) out.push(new GoogleCseProvider(cfg.GOOGLE_CSE_API_KEY, cfg.GOOGLE_CSE_ID));
      else onSkip(id, "GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID are not set");
    } else if (id === "fixture") {
      out.push(cfg.SEARCH_FIXTURE_FILE ? FixtureSearchProvider.fromFile(cfg.SEARCH_FIXTURE_FILE) : new FixtureSearchProvider([]));
    } else onSkip(id, "unknown search provider");
  }
  return out;
}
