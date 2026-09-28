import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { LLMProvider } from "./provider";

/**
 * Claude-backed provider using structured outputs. Failures (API errors,
 * refusals, truncation, schema mismatch) return null so callers fall back to
 * deterministic behaviour instead of failing user-facing work.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
    private readonly onError: (task: string, err: unknown) => void = () => {},
  ) {
    this.client = new Anthropic(apiKey ? { apiKey, maxRetries: 2, timeout: 60_000 } : { maxRetries: 2, timeout: 60_000 });
  }

  async generateJson<S extends z.ZodType>(params: { task: string; system: string; prompt: string; schema: S; maxTokens?: number }): Promise<z.infer<S> | null> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: params.maxTokens ?? 4000,
        system: params.system,
        output_config: { effort: "low", format: zodOutputFormat(params.schema) },
        messages: [{ role: "user", content: params.prompt }],
      });
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        this.onError(params.task, new Error(`stop_reason=${response.stop_reason}`));
        return null;
      }
      const parsed = response.parsed_output;
      if (parsed == null) return null;
      const check = params.schema.safeParse(parsed);
      return check.success ? (check.data as z.infer<S>) : null;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) this.onError(params.task, new Error("rate_limited"));
      else if (err instanceof Anthropic.APIError) this.onError(params.task, new Error(`api_error_${err.status}`));
      else this.onError(params.task, err);
      return null;
    }
  }
}
