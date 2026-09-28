import type { WorkflowStep } from "./definition";
import type { RunScope, StepDeps, StepResult } from "./types";
import { PageSession } from "./browser";
import { lookup, render } from "./template";
import { canonicalUrl } from "../../core/normalize";

type Executor = (step: WorkflowStep, scope: RunScope, page: PageSession, deps: StepDeps) => Promise<StepResult>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function renderOrFail(tpl: string, scope: RunScope): { value: string } | { fail: StepResult } {
  const missing: string[] = [];
  const value = render(tpl, scope, missing);
  if (missing.length) {
    return { fail: { status: "FAIL", code: "MISSING_DATA", retryable: false, error: `Missing data for: ${missing.join(", ")}` } };
  }
  return { value };
}

const executors: Record<WorkflowStep["type"], Executor> = {
  async OPEN_URL(step, scope, page) {
    const r = renderOrFail(str(step.params.url), scope);
    if ("fail" in r) return r.fail;
    const res = await page.open(r.value);
    if (res.status === 404 || res.status === 410) {
      return { status: "FAIL", code: "PAGE_NOT_FOUND", retryable: false, error: `Page returned ${res.status}` };
    }
    scope.context.formUrl = r.value;
    return { status: "OK", output: { httpStatus: res.status } };
  },

  async SEARCH(step, scope, page) {
    const base = renderOrFail(str(step.params.url), scope);
    if ("fail" in base) return base.fail;
    const target = new URL(base.value);
    for (const [k, v] of Object.entries((step.params.query as Record<string, string>) ?? {})) {
      const r = renderOrFail(v, scope);
      if ("fail" in r) return r.fail;
      target.searchParams.set(k, r.value);
    }
    await page.open(target.toString());
    const results = page.links(str(step.params.resultSelector, "a"));
    scope.secure[str(step.params.storeAs, "results")] = results;
    return { status: "OK", output: { resultCount: results.length } };
  },

  async SELECT_RESULT(step, scope) {
    const results = (scope.secure[str(step.params.from, "results")] as Array<{ href: string }>) ?? [];
    const want = canonicalUrl(scope.record.url);
    const hit = results.find((r) => canonicalUrl(r.href) === want);
    if (!hit) {
      return {
        status: "FAIL",
        code: "NOT_FOUND_AT_SOURCE",
        retryable: false,
        error: "The matching profile was not found on the site (it may already be removed)",
      };
    }
    scope.secure[str(step.params.storeAs, "selectedUrl")] = hit.href;
    return { status: "OK", output: { selected: true } };
  },

  async FILL_FIELD(step, scope, page) {
    const form = str(step.params.form);
    const field = str(step.params.field);
    const tpl = str(step.params.value);
    // Validate against the live form so layout changes fail fast.
    if (page.html) {
      const snapshot = page.form(form);
      if (!snapshot.fieldNames.includes(field)) {
        return { status: "FAIL", code: "LAYOUT_CHANGED", retryable: false, error: `Field "${field}" not found in ${form}` };
      }
    }
    const check = renderOrFail(tpl, scope);
    if ("fail" in check) return check.fail;
    // Store the *template*, not the value: values are resolved at submit time.
    const fields = (scope.context.fields ??= {}) as Record<string, Record<string, string>>;
    (fields[form] ??= {})[field] = tpl;
    return { status: "OK", output: { field } };
  },

  async USER_CONFIRMATION(step, _scope, _page, deps) {
    if (deps.preAuthorized && step.params.skipWhenPreAuthorized !== false) {
      return { status: "OK", output: { preAuthorized: true } };
    }
    return {
      status: "PAUSE",
      resume: "next",
      action: {
        kind: "CONFIRM_SUBMISSION",
        title: "Approval required",
        message: str(step.params.message, `We've prepared an opt-out request for ${deps.sourceName}. Approve to submit it.`),
        choices: ["done", "skip"],
      },
    };
  },

  async UPLOAD_USER_PROVIDED_DOCUMENT(step, _scope, _page, deps) {
    return {
      status: "PAUSE",
      resume: "manual",
      action: {
        kind: "IDENTITY_DOCUMENT",
        title: "Identity confirmation required",
        message: str(
          step.params.message,
          `${deps.sourceName} requires an identity document. Upload it only if you are comfortable doing so — you can also complete this step directly on their site or skip this provider.`,
        ),
        url: deps.optOutUrl,
        choices: ["continue_manually", "skip"],
      },
    };
  },

  async SUBMIT(step, scope, page) {
    const selector = str(step.params.form);
    if (!page.has(selector)) {
      const formUrl = str(scope.context.formUrl);
      if (!formUrl) return { status: "FAIL", code: "NO_FORM", retryable: false, error: "No form page to submit" };
      await page.open(formUrl);
    }
    const snapshot = page.form(selector);
    const templates = ((scope.context.fields as Record<string, Record<string, string>>) ?? {})[selector] ?? {};
    const values: Record<string, string> = {};
    for (const [k, tpl] of Object.entries(templates)) {
      const r = renderOrFail(tpl, scope);
      if ("fail" in r) return r.fail;
      values[k] = r.value;
    }
    const res = await page.submit(snapshot, values);
    const text = page.text();
    const success = new RegExp(str(step.params.successPattern, "."), "i");
    if (res.status >= 400 || !success.test(text)) {
      return {
        status: "FAIL",
        code: "SUBMISSION_NOT_CONFIRMED",
        retryable: false,
        error: `Submission was not acknowledged by the site (HTTP ${res.status})`,
      };
    }
    const refMatch = step.params.confirmationPattern ? new RegExp(str(step.params.confirmationPattern)).exec(text) : null;
    if (refMatch?.[1]) scope.context.confirmationRef = refMatch[1];
    if (step.params.emailVerificationPattern && new RegExp(str(step.params.emailVerificationPattern), "i").test(text)) {
      scope.context.emailVerificationRequired = true;
    }
    scope.context.submittedAt = new Date().toISOString();
    return { status: "OK", output: { confirmationRef: scope.context.confirmationRef ?? null, emailVerificationRequired: !!scope.context.emailVerificationRequired } };
  },

  async SEND_EMAIL(step, scope, _page, deps) {
    if (!deps.mailer) return { status: "FAIL", code: "NO_MAILER", retryable: false, error: "Outbound mail is not configured" };
    const to = deps.request?.recipient ?? render(str(step.params.to), scope);
    if (!to || !deps.request?.body) {
      return { status: "FAIL", code: "MISSING_DATA", retryable: false, error: "Approved request content is missing" };
    }
    const sent = await deps.mailer.send({
      to,
      subject: deps.request.subject ?? "Personal information removal request",
      text: deps.request.body,
      replyTo: scope.subject.contactEmail || undefined,
    });
    scope.context.confirmationRef = sent.messageId;
    scope.context.submittedAt = new Date().toISOString();
    return { status: "OK", output: { messageId: sent.messageId } };
  },

  async WAIT_FOR_EMAIL(step, _scope, _page, deps) {
    return {
      status: "PAUSE",
      resume: "next",
      action: {
        kind: "EMAIL_VERIFICATION",
        title: "Action required",
        message: str(step.params.message, `${deps.sourceName} requires email verification. We've prepared everything — open the verification email and click the link.`),
        choices: ["done", "skip"],
      },
    };
  },

  async VERIFY_EMAIL(step, scope, page, deps) {
    const manual: StepResult = {
      status: "PAUSE",
      resume: "next",
      action: {
        kind: "EMAIL_VERIFICATION",
        title: "Action required",
        message: `${deps.sourceName} sent a verification email to your contact address. Open it and click the confirmation link, then let us know.`,
        choices: ["done", "skip"],
      },
    };
    if (!deps.inbox || !scope.subject.contactIsRelay) return manual;

    const since = new Date(str(scope.context.submittedAt) || deps.now().toISOString());
    const baseHost = new URL(scope.base).hostname;
    const allowedHosts = new Set([baseHost, scope.sourceDomain, `www.${scope.sourceDomain}`]);
    const pattern = new RegExp(str(step.params.linkPattern, "https?://\\S+"), "i");
    const msg = await deps.inbox.find({ since, fromDomains: [scope.sourceDomain, baseHost], pattern });
    if (msg) {
      const link = pattern.exec(msg.body)?.[0];
      if (!link) return manual;
      const host = new URL(link).hostname;
      // Only follow confirmation links that point back at the source itself.
      if (!allowedHosts.has(host)) {
        return { status: "FAIL", code: "UNTRUSTED_LINK", retryable: false, error: "Verification link points to an unexpected domain" };
      }
      await page.open(link);
      await deps.inbox.consume(msg.id);
      const ok = new RegExp(str(step.params.successPattern, "."), "i").test(page.text());
      if (!ok) return { status: "FAIL", code: "EMAIL_VERIFICATION_FAILED", retryable: false, error: "Verification link did not confirm the request" };
      scope.context.emailVerified = true;
      return { status: "OK", output: { verifiedVia: "relay" } };
    }
    const maxWaitMin = Number(step.params.maxWaitMinutes ?? 60 * 24);
    const pollMin = Number(step.params.pollMinutes ?? 5);
    if (deps.now().getTime() - since.getTime() > maxWaitMin * 60_000) return manual;
    return { status: "WAIT", advance: false, until: new Date(deps.now().getTime() + pollMin * 60_000) };
  },

  async WAIT(step, _scope, _page, deps) {
    const minutes = Number(step.params.minutes ?? 0) + Number(step.params.days ?? 0) * 1440;
    return { status: "WAIT", advance: true, until: new Date(deps.now().getTime() + minutes * 60_000) };
  },

  async CHECK_STATUS(step, scope, page) {
    const r = renderOrFail(str(step.params.url), scope);
    if ("fail" in r) return r.fail;
    await page.open(r.value);
    const done = new RegExp(str(step.params.completedPattern, "completed"), "i").test(page.html);
    scope.context.sourceReportsCompleted = done;
    return { status: "OK", output: { sourceReportsCompleted: done } };
  },

  async VERIFY_REMOVAL(_step, scope, _page, deps) {
    if (!deps.verifyRemoval) return { status: "SKIP", reason: "No verifier configured" };
    const v = await deps.verifyRemoval();
    scope.context.verificationOutcome = v.outcome;
    return { status: "OK", output: { outcome: v.outcome } };
  },
};

export function executorFor(type: WorkflowStep["type"]): Executor {
  return executors[type];
}

export function isStepEnabled(step: WorkflowStep, scope: RunScope): boolean {
  return step.when ? Boolean(lookup(scope, step.when)) : true;
}
