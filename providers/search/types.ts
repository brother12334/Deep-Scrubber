/**
 * Search provider adapter (spec §4). Only authorized, documented search APIs
 * are supported — never scraping of search engine result pages.
 */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface SearchProvider {
  /** Stable id stored on records, e.g. "brave", "google". */
  readonly id: string;
  /** Human-readable engine name for the UI. */
  readonly engineName: string;
  search(query: string, opts?: { count?: number; signal?: AbortSignal }): Promise<SearchResult[]>;
}

export class SearchProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`${provider}: ${message}`);
    this.name = "SearchProviderError";
  }
}
