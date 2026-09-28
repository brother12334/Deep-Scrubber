import type { AppConfig } from "../shared/config";
import { AnthropicProvider } from "./anthropic";
import { NullProvider, type LLMProvider } from "./provider";

export type { LLMProvider } from "./provider";

export function createLLMProvider(cfg: AppConfig, onError?: (task: string, err: unknown) => void): LLMProvider {
  if (cfg.AI_PROVIDER === "anthropic") return new AnthropicProvider(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL, onError);
  return new NullProvider();
}
