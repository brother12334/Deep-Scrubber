import type { AppConfig } from "../../shared/config";
import { BraveSearchProvider } from "./brave";
import { FixtureSearchProvider } from "./fixture";
import { GoogleCseProvider } from "./google-cse";
import type { SearchProvider } from "./types";

export * from "./types";
export { FixtureSearchProvider } from "./fixture";

/** Build the configured providers. Providers without credentials are skipped. */
export function createSearchProviders(cfg: AppConfig): SearchProvider[] {
  const out: SearchProvider[] = [];
  for (const id of cfg.SEARCH_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (id === "brave" && cfg.BRAVE_SEARCH_API_KEY) out.push(new BraveSearchProvider(cfg.BRAVE_SEARCH_API_KEY));
    else if (id === "google" && cfg.GOOGLE_CSE_API_KEY && cfg.GOOGLE_CSE_ID) out.push(new GoogleCseProvider(cfg.GOOGLE_CSE_API_KEY, cfg.GOOGLE_CSE_ID));
    else if (id === "fixture") {
      out.push(cfg.SEARCH_FIXTURE_FILE ? FixtureSearchProvider.fromFile(cfg.SEARCH_FIXTURE_FILE) : new FixtureSearchProvider([]));
    }
  }
  return out;
}
