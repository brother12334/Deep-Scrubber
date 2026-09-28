import type { HttpClient } from "../../../removal-agents/engine/browser";
import { HostBudget, safeFetch, type FetchPolicy, type SafeFetchInit } from "../../../security/ssrf";

/** HttpClient backed by the SSRF-hardened fetcher, with a per-job crawl budget. */
export class SafeHttpClient implements HttpClient {
  constructor(
    private readonly policy: FetchPolicy,
    private readonly budget: HostBudget = new HostBudget(25),
  ) {}

  request(url: string, init?: SafeFetchInit) {
    return safeFetch(url, init, this.policy, { budget: this.budget });
  }

  /** Fresh client with its own budget (one per job). */
  scoped(perHost = 25): SafeHttpClient {
    return new SafeHttpClient(this.policy, new HostBudget(perHost));
  }
}
