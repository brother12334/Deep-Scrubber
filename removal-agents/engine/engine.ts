import type { WorkflowDefinition } from "./definition";
import { NON_IDEMPOTENT_STEPS } from "./definition";
import { HumanVerificationRequired, PageSession } from "./browser";
import { executorFor, isStepEnabled } from "./steps";
import type { RunOutcome, RunScope, StepDeps, StepRecorder, WorkflowRunState } from "./types";
import { AutomationError } from "../../shared/errors";
import { UnsafeUrlError } from "../../security/ssrf";

const MAX_STEPS_PER_RUN = 60;

/**
 * Generic workflow interpreter (spec §7). Executes a structured definition
 * step by step, checkpointing after every step so a run can pause for a
 * human, wait for time to pass, or resume after a crash.
 *
 * Safety properties:
 *  - Non-idempotent steps (SUBMIT, SEND_EMAIL) are never re-executed if a
 *    previous attempt started but did not finish: the run fails into manual
 *    review instead of risking duplicate or malformed submissions.
 *  - Human verification (CAPTCHA etc.) always pauses the run (spec §30).
 *  - SSRF-unsafe URLs fail permanently.
 */
export class WorkflowEngine {
  async run(
    def: WorkflowDefinition,
    state: WorkflowRunState,
    scopeBase: Omit<RunScope, "context" | "secure">,
    deps: StepDeps,
    recorder: StepRecorder,
  ): Promise<RunOutcome> {
    const scope: RunScope = { ...scopeBase, context: state.context, secure: state.secure };
    const page = new PageSession(deps.http, (state.context.cookies as Record<string, string>) ?? {});
    let executed = 0;

    while (state.currentStep < def.steps.length) {
      if (++executed > MAX_STEPS_PER_RUN) {
        return { kind: "FAILED", state, error: "Workflow exceeded step budget", code: "STEP_BUDGET", retryable: false, stepIndex: state.currentStep };
      }
      const index = state.currentStep;
      const step = def.steps[index]!;

      if (!isStepEnabled(step, scope)) {
        const rec = await recorder.start(index, step.id, step.type);
        await recorder.finish(rec, "SKIPPED", { reason: `condition ${step.when} not met` });
        state.currentStep++;
        await recorder.checkpoint(state);
        continue;
      }

      if (NON_IDEMPOTENT_STEPS.has(step.type) && (await recorder.hasUnfinishedAttempt(index))) {
        return {
          kind: "FAILED",
          state,
          error: "A previous submission attempt did not complete; manual review is required to avoid duplicate submissions",
          code: "SUBMISSION_STATE_UNKNOWN",
          retryable: false,
          stepIndex: index,
        };
      }

      const rec = await recorder.start(index, step.id, step.type);
      let result;
      try {
        result = await executorFor(step.type)(step, scope, page, deps);
      } catch (err) {
        if (err instanceof HumanVerificationRequired) {
          await recorder.finish(rec, "PAUSED", { reason: "human_verification" });
          state.context.cookies = page.cookies;
          await recorder.checkpoint(state);
          return {
            kind: "PAUSED_FOR_USER",
            state,
            stepIndex: index,
            resume: "manual",
            action: {
              kind: "HUMAN_VERIFICATION",
              title: "Automation paused",
              message: `${deps.sourceName} requires human verification. We never attempt to bypass these checks. You can finish this opt-out yourself; we'll verify the result afterwards.`,
              url: deps.optOutUrl ?? err.url,
              choices: ["continue_manually", "skip"],
            },
          };
        }
        const retryable = err instanceof AutomationError ? err.retryable : !(err instanceof UnsafeUrlError);
        const code = err instanceof AutomationError ? err.code : err instanceof UnsafeUrlError ? "UNSAFE_URL" : "STEP_ERROR";
        const message = err instanceof Error ? err.message : String(err);
        // A thrown error inside a non-idempotent step leaves its record unfinished on purpose
        // only if we crashed; here we know it failed, so close it.
        await recorder.finish(rec, "FAILED", undefined, message);
        return { kind: "FAILED", state, error: message, code, retryable, stepIndex: index };
      }

      state.context.cookies = page.cookies;
      switch (result.status) {
        case "OK":
          await recorder.finish(rec, "SUCCEEDED", result.output);
          state.currentStep++;
          await recorder.checkpoint(state);
          break;
        case "SKIP":
          await recorder.finish(rec, "SKIPPED", { reason: result.reason });
          state.currentStep++;
          await recorder.checkpoint(state);
          break;
        case "PAUSE":
          await recorder.finish(rec, "PAUSED", { action: result.action.kind });
          await recorder.checkpoint(state);
          return { kind: "PAUSED_FOR_USER", state, action: result.action, resume: result.resume, stepIndex: index };
        case "WAIT":
          await recorder.finish(rec, "WAITING", { until: result.until.toISOString(), ...result.output });
          if (result.advance) state.currentStep++;
          await recorder.checkpoint(state);
          return { kind: "WAITING", state, resumeAt: result.until, stepIndex: index };
        case "FAIL":
          await recorder.finish(rec, "FAILED", { code: result.code }, result.error);
          await recorder.checkpoint(state);
          return { kind: "FAILED", state, error: result.error, code: result.code, retryable: result.retryable, stepIndex: index };
      }
    }
    return { kind: "COMPLETED", state };
  }
}

/** Advance past a step the user completed (e.g. clicked the verification link). */
export function markUserStepDone(state: WorkflowRunState, pausedStep: number): WorkflowRunState {
  return { ...state, currentStep: Math.max(state.currentStep, pausedStep + 1) };
}

/** In-memory recorder for tests and dry runs. */
export class MemoryRecorder implements StepRecorder {
  readonly records: Array<{ id: string; index: number; stepId: string; type: string; status: string; output?: Record<string, unknown>; error?: string }> = [];
  lastState?: WorkflowRunState;

  async start(index: number, stepId: string, type: string): Promise<string> {
    const id = String(this.records.length + 1);
    this.records.push({ id, index, stepId, type, status: "RUNNING" });
    return id;
  }
  async finish(id: string, status: string, output?: Record<string, unknown>, error?: string): Promise<void> {
    const r = this.records.find((x) => x.id === id)!;
    Object.assign(r, { status, output, error });
  }
  async hasUnfinishedAttempt(index: number): Promise<boolean> {
    return this.records.some((r) => r.index === index && r.status === "RUNNING");
  }
  async checkpoint(state: WorkflowRunState): Promise<void> {
    this.lastState = structuredClone(state);
  }
}
