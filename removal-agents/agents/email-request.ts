import type { SubjectProfile } from "../../core/subject";
import type { WorkflowDefinition } from "../engine/definition";
import type { AgentContext, AgentRecord, PreparedRequest, RemovalPlan, SubmissionResult, SubmitInput } from "../types";
import { WorkflowAgent } from "./workflow-agent";

/** Built-in workflow: explicit approval (unless pre-authorised) → send the approved email. */
export function emailWorkflow(sourceId: string): WorkflowDefinition {
  return {
    source: sourceId,
    version: 1,
    description: "Send the approved removal request to the provider's published privacy contact.",
    steps: [
      { id: "confirm", type: "USER_CONFIRMATION", params: { skipWhenPreAuthorized: true } },
      { id: "send", type: "SEND_EMAIL", params: {} },
    ],
  };
}

/**
 * Sends a removal request to a provider's published privacy address. The
 * message body is the user-approved draft (see ai/request-generator.ts); it
 * is sent from the service with Reply-To set to the user's contact address.
 */
export class EmailRequestAgent extends WorkflowAgent {
  override readonly key = "email-request";

  override getRemovalMethod(ctx: AgentContext, _record: AgentRecord): RemovalPlan {
    if (!ctx.source.privacyContactEmail) {
      return { method: "EMAIL_REQUEST", automation: "USER_ACTION_REQUIRED", explanation: "No published privacy contact is on file." };
    }
    return {
      method: "EMAIL_REQUEST",
      automation: ctx.source.automationPaused ? "MANUAL_REVIEW" : "SEMI_AUTOMATED",
      explanation: "We email the provider's published privacy contact with the request you approve.",
      recipient: ctx.source.privacyContactEmail,
    };
  }

  override createRequest(ctx: AgentContext, _record: AgentRecord, _subject: SubjectProfile): PreparedRequest {
    return {
      method: "EMAIL_REQUEST",
      recipient: ctx.source.privacyContactEmail ?? ctx.source.name,
      fieldsShared: ["The URL of the listing about you", "Your name", "Your contact email (as Reply-To)"],
    };
  }

  override async submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult> {
    return super.submitRequest({ ...ctx, workflow: ctx.workflow ?? { definition: emailWorkflow(ctx.source.id), configId: null } }, input);
  }
}
