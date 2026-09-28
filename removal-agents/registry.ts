import { EmailRequestAgent } from "./agents/email-request";
import { ExampleBrokerAgent } from "./agents/example-broker";
import { ManualGuidanceAgent } from "./agents/manual-guidance";
import { SearchEngineAgent } from "./agents/search-engine";
import { UserControlledSiteAgent } from "./agents/user-controlled-site";
import { WorkflowAgent } from "./agents/workflow-agent";
import type { RemovalAgent } from "./types";

/**
 * Agent registry. `data_sources.agent_key` selects the implementation.
 * To support a new broker whose opt-out is a normal web form, use the
 * generic "workflow" agent plus a JSON workflow — no code required.
 */
export function createAgentRegistry(): Map<string, RemovalAgent> {
  const agents: RemovalAgent[] = [
    new WorkflowAgent(),
    new ExampleBrokerAgent(),
    new ManualGuidanceAgent(),
    new EmailRequestAgent(),
    new SearchEngineAgent(),
    new UserControlledSiteAgent(),
  ];
  return new Map(agents.map((a) => [a.key, a]));
}

export function agentFor(registry: Map<string, RemovalAgent>, key: string | null | undefined): RemovalAgent {
  return registry.get(key ?? "") ?? registry.get("manual-guidance")!;
}
