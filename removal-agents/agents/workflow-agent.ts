import type { SubjectProfile } from "../../core/subject";
import { WorkflowEngine } from "../engine/engine";
import type { AgentContext, AgentRecord, PreparedRequest, RemovalPlan, SubmissionResult, SubmitInput } from "../types";
import { BaseAgent, toTemplateSubject } from "./base";

/**
 * Runs a structured workflow definition (from provider_configs) through the
 * generic engine. Most automatable sources need nothing more than this plus
 * a JSON definition.
 */
export class WorkflowAgent extends BaseAgent {
  readonly key: string = "workflow";
  private readonly engine = new WorkflowEngine();

  getRemovalMethod(ctx: AgentContext, _record: AgentRecord): RemovalPlan {
    const method = ctx.source.removalMethods[0] ?? "WEB_FORM";
    if (ctx.source.automationPaused) {
      return { method, automation: "MANUAL_REVIEW", explanation: "Automation for this provider is paused while its workflow is reviewed." };
    }
    if (!ctx.workflow) {
      return { method, automation: "USER_ACTION_REQUIRED", explanation: "No active automated workflow is configured for this provider." };
    }
    return {
      method,
      automation: ctx.source.automationStatus,
      explanation: ctx.source.requiresEmailVerification
        ? "Automated submission; the provider also requires email confirmation."
        : "Automated submission through the provider's official opt-out form.",
    };
  }

  createRequest(ctx: AgentContext, record: AgentRecord, _subject: SubjectProfile): PreparedRequest {
    return {
      method: this.getRemovalMethod(ctx, record).method,
      recipient: ctx.source.name,
      fieldsShared: ["The URL of the listing about you", "Your contact email (for the provider's confirmation)"],
    };
  }

  async submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult> {
    if (!ctx.workflow) {
      return { status: "FAILED", error: "No workflow configured", code: "NO_WORKFLOW", retryable: false, state: input.state };
    }
    if (ctx.source.automationPaused) {
      return { status: "FAILED", error: "Provider automation is paused", code: "PROVIDER_PAUSED", retryable: false, state: input.state };
    }
    const outcome = await this.engine.run(
      ctx.workflow.definition,
      input.state,
      {
        base: ctx.baseUrl,
        sourceDomain: ctx.source.domain,
        subject: toTemplateSubject(input.subject),
        record: { url: input.record.url },
      },
      {
        http: ctx.http,
        now: ctx.now,
        preAuthorized: input.preAuthorized,
        sourceName: ctx.source.name,
        optOutUrl: ctx.source.optOutUrl,
        inbox: ctx.inbox,
        mailer: ctx.mailer,
        request: input.request,
        verifyRemoval: async () => this.verifyRemoval(ctx, input.record, input.subject),
      },
      input.recorder,
    );
    switch (outcome.kind) {
      case "COMPLETED":
        return {
          status: "SUBMITTED",
          confirmationRef: outcome.state.context.confirmationRef as string | undefined,
          sourceReportsCompleted: outcome.state.context.sourceReportsCompleted as boolean | undefined,
          state: outcome.state,
        };
      case "PAUSED_FOR_USER":
        return { status: "REQUIRES_USER_ACTION", action: outcome.action, resume: outcome.resume, stepIndex: outcome.stepIndex, state: outcome.state };
      case "WAITING":
        return { status: "WAITING", resumeAt: outcome.resumeAt, state: outcome.state };
      case "FAILED":
        if (outcome.code === "NOT_FOUND_AT_SOURCE") return { status: "NOT_FOUND_AT_SOURCE", state: outcome.state };
        return { status: "FAILED", error: outcome.error, code: outcome.code, retryable: outcome.retryable, state: outcome.state };
    }
  }
}
