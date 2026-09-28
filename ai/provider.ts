import type { z } from "zod";

/**
 * Provider-agnostic LLM interface (spec §32). AI is advisory: every caller
 * has a deterministic fallback and validates outputs before use. AI never
 * decides to perform an irreversible action.
 */
export interface LLMProvider {
  readonly id: string;
  /** Returns schema-validated output, or null when unavailable/refused/invalid. */
  generateJson<S extends z.ZodType>(params: {
    task: string;
    system: string;
    prompt: string;
    schema: S;
    maxTokens?: number;
  }): Promise<z.infer<S> | null>;
}

/** Used when no AI provider is configured: callers fall back to deterministic logic. */
export class NullProvider implements LLMProvider {
  readonly id = "none";
  async generateJson(): Promise<null> {
    return null;
  }
}
