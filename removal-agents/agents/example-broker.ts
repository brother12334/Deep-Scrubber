import type { SubjectProfile } from "../../core/subject";
import type { AgentContext, DiscoveredCandidate } from "../types";
import { WorkflowAgent } from "./workflow-agent";

/**
 * Reference site-specific agent for the bundled ExampleBroker mock.
 *
 * Discovery uses the broker's own public search (the same page any visitor
 * can use), then loads each result's public profile page for matching.
 * Removal uses the generic workflow engine with the versioned definition in
 * providers/registry/workflows/example-broker.v1.json.
 */
export class ExampleBrokerAgent extends WorkflowAgent {
  override readonly key = "example-broker";

  override async discover(ctx: AgentContext, subject: SubjectProfile): Promise<DiscoveredCandidate[]> {
    const out: DiscoveredCandidate[] = [];
    const seen = new Set<string>();
    const regions = subject.locations.map((l) => l.region?.toUpperCase()).filter(Boolean) as string[];
    for (const name of [...subject.names, ...subject.previousNames].slice(0, 3)) {
      for (const region of regions.length ? [...new Set(regions)].slice(0, 3) : [""]) {
        const url = new URL(`${ctx.baseUrl}/search`);
        url.searchParams.set("name", name);
        if (region) url.searchParams.set("state", region);
        const res = await ctx.http.request(url.toString());
        if (res.status !== 200) continue;
        const links = [...res.body.matchAll(/<a class="profile-link" href="([^"]+)">/g)].map((m) => new URL(m[1]!, ctx.baseUrl).toString());
        for (const link of links.slice(0, 10)) {
          if (seen.has(link)) continue;
          seen.add(link);
          const page = await ctx.http.request(link);
          if (page.status !== 200) continue;
          out.push({
            url: link,
            title: /<title>([^<]*)<\/title>/.exec(page.body)?.[1],
            text: "",
            html: page.body,
            discoveryMethod: "SITE_SEARCH",
            sourceId: ctx.source.id,
            targetedSearch: true,
          });
        }
      }
    }
    return out;
  }
}
