import type { SubjectProfile } from "../../core/subject";
import type { AgentContext, AgentRecord, PreparedRequest, RemovalPlan, SubmissionResult, SubmitInput } from "../types";
import { BaseAgent } from "./base";

/**
 * For sources where automation is not permitted or not reliable (human
 * verification, account logins, identity checks). The platform still does the
 * work of finding the listing, preparing the steps and verifying the result;
 * the user performs the submission themselves.
 */
export class ManualGuidanceAgent extends BaseAgent {
  readonly key: string = "manual-guidance";

  getRemovalMethod(ctx: AgentContext, _record: AgentRecord): RemovalPlan {
    return {
      method: ctx.source.removalMethods[0] ?? "WEB_FORM",
      automation: "USER_ACTION_REQUIRED",
      explanation: ctx.source.requiresUserVerification
        ? `${ctx.source.name} requires steps only you can complete (for example human verification or signing in).`
        : `${ctx.source.name} does not support automated requests yet.`,
    };
  }

  createRequest(ctx: AgentContext, record: AgentRecord, _subject: SubjectProfile): PreparedRequest {
    const method = ctx.source.removalMethods[0];
    const steps =
      method === "ACCOUNT_SETTINGS"
        ? [
            `Sign in to ${ctx.source.name} yourself (we never ask for your password).`,
            "Open your profile or privacy settings.",
            "Remove or hide the details you no longer want public, or make the profile private.",
            "Come back and tell us you're done — we'll verify the change.",
          ]
        : [
            `Open ${ctx.source.name}'s official opt-out page.`,
            "Search for your listing and select the one we found (link below).",
            ctx.source.requiresEmailVerification
              ? "Submit the form and confirm the email they send you."
              : "Submit the form and complete any verification the site asks for.",
            "Come back and tell us you're done — we'll verify the removal.",
          ];
    return {
      method: method ?? "WEB_FORM",
      recipient: ctx.source.name,
      fieldsShared: ["Nothing is sent automatically — you submit the request yourself."],
      manualAction: {
        kind: "MANUAL_OPT_OUT",
        title: `Complete the opt-out on ${ctx.source.name}`,
        message: `We found your listing${record.url ? "" : ""} and prepared the steps. ${ctx.source.name} requires you to submit the request yourself.`,
        url: ctx.source.optOutUrl,
        instructions: steps,
        choices: ["done", "skip"],
      },
    };
  }

  async submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult> {
    const prepared = this.createRequest(ctx, input.record, input.subject);
    return { status: "REQUIRES_USER_ACTION", action: prepared.manualAction!, resume: "manual", stepIndex: 0, state: input.state };
  }
}
