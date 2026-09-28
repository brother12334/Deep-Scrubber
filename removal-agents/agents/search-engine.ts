import type { SubjectProfile } from "../../core/subject";
import type { AgentContext, AgentRecord, PreparedRequest, RemovalPlan, SubmissionResult, SubmitInput, VerificationResult } from "../types";
import { BaseAgent } from "./base";

/**
 * Search-result de-indexing (spec §9). Search appearances are tracked
 * separately from their source. We only point users at the engines' official
 * processes and never claim guaranteed de-indexing.
 */
export class SearchEngineAgent extends BaseAgent {
  readonly key = "search-engine";

  getRemovalMethod(_ctx: AgentContext, record: AgentRecord): RemovalPlan {
    return {
      method: "SEARCH_ENGINE_REMOVAL",
      automation: "USER_ACTION_REQUIRED",
      explanation: record.originGone
        ? "The original page no longer shows this information; request an outdated-content refresh."
        : "Search engines accept removal requests for results showing personal contact information.",
    };
  }

  createRequest(ctx: AgentContext, record: AgentRecord, _subject: SubjectProfile): PreparedRequest {
    const engine = ctx.source.name;
    const instructions = record.originGone
      ? [
          `Open ${engine}'s outdated content / refresh tool.`,
          "Paste the result URL shown below and submit.",
          "The engine re-crawls the page; this can take days to weeks.",
        ]
      : [
          `Open ${engine}'s personal information removal form.`,
          "Provide the result URL and select the type of personal information shown.",
          "Note: this only affects search results — the original page stays online until the site removes it.",
        ];
    return {
      method: "SEARCH_ENGINE_REMOVAL",
      recipient: engine,
      fieldsShared: ["Nothing is sent automatically — you submit the request yourself."],
      manualAction: {
        kind: "SEARCH_ENGINE_FORM",
        title: record.originGone ? `Refresh outdated ${engine} result` : `Request removal from ${engine} results`,
        message: "Removal from search results is never guaranteed and does not delete the original page.",
        url: ctx.source.optOutUrl,
        instructions,
        choices: ["done", "skip"],
      },
    };
  }

  async submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult> {
    const p = this.createRequest(ctx, input.record, input.subject);
    return { status: "REQUIRES_USER_ACTION", action: p.manualAction!, resume: "manual", stepIndex: 0, state: input.state };
  }

  override async verifyRemoval(ctx: AgentContext, record: AgentRecord, subject: SubjectProfile): Promise<VerificationResult> {
    if (!ctx.searchVerifier || !record.searchEngine) {
      return { found: null, outcome: "INCONCLUSIVE", method: "SEARCH_RECHECK", details: { reason: "engine_unavailable" } };
    }
    const query = `"${subject.names[0] ?? ""}"`;
    const listed = await ctx.searchVerifier.isUrlListed(record.searchEngine, query, record.url);
    if (listed === null) return { found: null, outcome: "INCONCLUSIVE", method: "SEARCH_RECHECK", details: { reason: "engine_unavailable" } };
    return listed
      ? { found: true, outcome: "STILL_PRESENT", method: "SEARCH_RECHECK", details: { engine: record.searchEngine } }
      : { found: false, outcome: "REMOVED_FROM_SEARCH_RESULTS", method: "SEARCH_RECHECK", details: { engine: record.searchEngine } };
  }
}
