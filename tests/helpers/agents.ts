import { readFileSync } from "node:fs";
import type { SourceRuntime } from "../../removal-agents/types";
import { WorkflowDefinitionSchema } from "../../removal-agents/engine/definition";
import { SafeHttpClient } from "../../backend/src/infra/http-client";
import { defaultFetchPolicy } from "../../security/ssrf";

export const devHttp = () => new SafeHttpClient({ ...defaultFetchPolicy, privateHostAllowlist: ["127.0.0.1"] });

export const exampleBrokerWorkflow = () =>
  WorkflowDefinitionSchema.parse(JSON.parse(readFileSync("providers/registry/workflows/example-broker.v1.json", "utf8")));

export const exampleBrokerSource = (over: Partial<SourceRuntime> = {}): SourceRuntime => ({
  ...(JSON.parse(readFileSync("providers/registry/sources/example-broker.json", "utf8")) as SourceRuntime),
  enabled: true,
  automationPaused: false,
  ...over,
});
