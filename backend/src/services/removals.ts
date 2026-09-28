import type { PoolClient } from "pg";
import { generateRemovalRequest } from "../../../ai/request-generator";
import { PLANS } from "../../../core/abuse";
import { canAutoSubmit, MATCH_THRESHOLDS } from "../../../core/matching";
import { suggestPathways, type PathwaySuggestion } from "../../../core/pathways";
import { markUserStepDone } from "../../../removal-agents/engine/engine";
import type { StepRecorder, WorkflowRunState } from "../../../removal-agents/engine/types";
import { agentFor } from "../../../removal-agents/registry";
import type { AgentContext, RemovalAgent, SourceRuntime, SubmissionResult } from "../../../removal-agents/types";
import type { ApprovalMode, PlanId, RemovalRequestStatus, UserAction } from "../../../shared/domain";
import { AppError, badRequest, conflict, notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { JobNames } from "../infra/queue";
import { audit } from "./audit";
import { notifyProfileOwner } from "./notifications";
import { loadSubject, type ProfileRow } from "./profiles";
import { decryptUrl, getRecord, setRecordStatus, toAgentRecord, type RecordRow } from "./records";
import { activeWorkflow, baseUrlFor, getSource } from "./sources";

/**
 * Removal lifecycle (spec §6–§8, §10–§12, §25).
 *
 *   plan → (approval) → run agent/workflow → [user action | wait] → submitted
 *        → verification job scheduled
 *
 * Authorization rules are enforced here in deterministic code:
 *   - nothing is submitted for a match below STRONG unless the user confirmed it
 *   - AUTOMATIC mode requires a paid plan *and* recorded blanket authorization
 *   - flagged profiles never auto-submit
 *   - paused providers never auto-submit
 */

export interface RequestRow {
  id: string;
  profile_id: string;
  record_id: string;
  source_id: string | null;
  method: string;
  pathway: string;
  pathway_confidence: string;
  pathway_rationale: string;
  status: RemovalRequestStatus;
  approval_mode: ApprovalMode;
  recipient: string | null;
  request_subject: string | null;
  request_body_ciphertext: string | null;
  approved_at: Date | null;
  submitted_at: Date | null;
  confirmation_ref: string | null;
  attempt_count: number;
  next_check_at: Date | null;
  user_action: (UserAction & { resume?: "next" | "manual"; stepIndex?: number }) | null;
  last_error: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const bodyAad = (profileId: string) => `request:${profileId}`;
const OPEN_STATUSES = ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "REQUIRES_USER_ACTION", "SUBMITTED", "AWAITING_VERIFICATION"];

/** Fallback source for records on unknown sites: generic manual guidance. */
function genericSource(domain: string): SourceRuntime {
  return {
    id: `site:${domain}`,
    name: domain,
    domain,
    categories: ["OTHER"],
    discoveryMethods: ["SEARCH_API"],
    removalMethods: ["WEB_FORM"],
    requiresUserVerification: false,
    requiresEmailVerification: false,
    requiresIdentityVerification: false,
    estimatedRemovalTime: 14,
    reappearsFrequently: false,
    supportedRegions: ["*"],
    automationStatus: "MANUAL_REVIEW",
    agent: "manual-guidance",
    enabled: true,
    automationPaused: false,
  };
}

export async function agentContextFor(ctx: AppContext, record: RecordRow): Promise<{ agent: RemovalAgent; actx: AgentContext }> {
  const src = record.source_id ? await getSource(ctx, record.source_id) : undefined;
  const source = src ?? genericSource(record.domain);
  let agentKey = source.agent;
  if (record.category === "USER_CONTROLLED") agentKey = "user-controlled-site";
  else if (record.is_search_result) agentKey = "search-engine";
  const agent = agentFor(ctx.agents, agentKey);
  const workflow = src ? await activeWorkflow(ctx, src.id) : undefined;
  return {
    agent,
    actx: {
      source: record.is_search_result && !src ? { ...genericSource(record.search_engine ?? "search"), name: record.search_engine ?? "Search engine" } : source,
      baseUrl: src ? baseUrlFor(ctx, src) : `https://${record.domain}`,
      http: ctx.http.scoped(),
      now: () => ctx.clock.now(),
      mailer: ctx.mailer,
      inbox: inboxReader(ctx, record.profile_id),
      searchVerifier: searchVerifier(ctx),
      workflow: workflow ? { definition: workflow.definition, configId: workflow.configId } : undefined,
    },
  };
}

async function effectiveApprovalMode(ctx: AppContext, profile: ProfileRow, sourceId: string | null): Promise<ApprovalMode> {
  if (sourceId) {
    const pref = await ctx.db.one<{ approval_mode: ApprovalMode }>(
      "SELECT approval_mode FROM source_preferences WHERE profile_id = $1 AND source_id = $2",
      [profile.id, sourceId],
    );
    if (pref) return pref.approval_mode;
  }
  return profile.default_approval_mode;
}

async function pathwaysFor(ctx: AppContext, profile: ProfileRow, record: RecordRow, source: SourceRuntime | undefined, originGone: boolean): Promise<PathwaySuggestion[]> {
  const j = profile.jurisdiction_code
    ? await ctx.db.one<{ name: string; mechanisms: string[] }>("SELECT name, mechanisms FROM jurisdictions WHERE code = $1", [profile.jurisdiction_code])
    : undefined;
  return suggestPathways({
    category: record.category,
    isSearchResult: record.is_search_result,
    sourceRemovalMethods: source?.removalMethods ?? [],
    userOwnsDomain: record.category === "USER_CONTROLLED",
    originGone,
    dataTypes: record.data_types,
    publicInterest: record.public_interest_flag,
    jurisdictionMechanisms: j?.mechanisms ?? [],
    jurisdictionName: j?.name,
    caseOutcome: profile.case_outcome,
  });
}

export async function getPathways(ctx: AppContext, record: RecordRow): Promise<PathwaySuggestion[]> {
  const profile = (await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1", [record.profile_id]))!;
  const source = record.source_id ? await getSource(ctx, record.source_id) : undefined;
  return pathwaysFor(ctx, profile, record, source, await originGone(ctx, record));
}

async function originGone(ctx: AppContext, record: RecordRow): Promise<boolean> {
  if (!record.parent_record_id) return false;
  const parent = await ctx.db.one<{ status: string }>("SELECT status FROM discovered_records WHERE id = $1", [record.parent_record_id]);
  return parent?.status === "REMOVED";
}

/**
 * Decide what to do with a newly discovered (or reappeared) record, creating a
 * removal request where appropriate. Returns the request id if one was made.
 */
export async function planRemoval(ctx: AppContext, recordId: string, opts: { initiatedBy?: string; force?: boolean } = {}): Promise<string | null> {
  const record = await getRecord(ctx, recordId);
  if (["DISMISSED", "NO_ACTION_AVAILABLE"].includes(record.status) && !opts.force) return null;
  if (record.public_interest_flag && !opts.force) return null;
  if (!canAutoSubmit(record.match_confidence, record.user_confirmed) && !opts.force) {
    if (record.status !== "NEEDS_REVIEW") await setRecordStatus(ctx, record.id, "NEEDS_REVIEW", "Please confirm this is you before we act.");
    return null;
  }
  if (record.user_confirmed === false) return null;
  const open = await ctx.db.one<{ id: string }>(`SELECT id FROM removal_requests WHERE record_id = $1 AND status = ANY($2)`, [record.id, OPEN_STATUSES]);
  if (open) return open.id;

  // Search appearances are handled through their origin first (dependency graph).
  if (record.is_search_result && record.parent_record_id && !opts.force) {
    const parentOpen = await ctx.db.one<{ status: string }>("SELECT status FROM discovered_records WHERE id = $1", [record.parent_record_id]);
    if (parentOpen && parentOpen.status !== "REMOVED" && parentOpen.status !== "DISMISSED") {
      await setRecordStatus(ctx, record.id, "DISCOVERED", "Will be re-checked automatically once the original source is removed.");
      return null;
    }
  }

  const profile = (await ctx.db.one<ProfileRow & { plan: PlanId }>(
    "SELECT p.*, u.plan FROM privacy_profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1",
    [record.profile_id],
  ))!;
  const { agent, actx } = await agentContextFor(ctx, record);
  const src = record.source_id ? await getSource(ctx, record.source_id) : undefined;
  const gone = await originGone(ctx, record);
  const pathways = await pathwaysFor(ctx, profile, record, src, gone);
  const top = pathways[0];
  if (!top) {
    await setRecordStatus(ctx, record.id, "NO_ACTION_AVAILABLE", "No legitimate removal process is available for this result.");
    return null;
  }
  // Court sealing happens through the courts, not through a request to a website.
  if (top.pathway === "RECORD_SEALING") {
    await setRecordStatus(ctx, record.id, "NO_ACTION_AVAILABLE", top.why);
    return null;
  }
  // Public-interest reporting: the only request we help with is asking the publisher to update it.
  if (record.public_interest_flag && top.pathway !== "NEWS_UPDATE_REQUEST") {
    await setRecordStatus(ctx, record.id, "NO_ACTION_AVAILABLE", "Lawful public-interest content. Removal requests aren't appropriate; see the pathways for what can help.");
    return null;
  }
  const arrestPathway = top.pathway === "NEWS_UPDATE_REQUEST" || top.pathway === "MUGSHOT_REMOVAL";
  const agentRecord = toAgentRecord(ctx, record, { originGone: gone });
  const plan = agent.getRemovalMethod(actx, agentRecord);
  const prepared = agent.createRequest(actx, agentRecord, await loadSubject(ctx, record.profile_id));

  // Draft the human-readable request (always previewable).
  const subject = await loadSubject(ctx, record.profile_id);
  const jur = profile.jurisdiction_code
    ? await ctx.db.one<{ frameworks: string[] }>("SELECT frameworks FROM jurisdictions WHERE code = $1", [profile.jurisdiction_code])
    : undefined;
  const draft = await generateRemovalRequest(
    {
      recipientName: actx.source.name,
      recipientAddress: actx.source.privacyContactEmail,
      method: plan.method,
      pathway: top.pathway,
      listingUrl: agentRecord.url,
      dataTypes: record.data_types,
      subjectName: subject.names[0] ?? "",
      contactEmail: subject.contactEmail,
      userFacts: [],
      allowedFrameworks: jur?.frameworks ?? [],
      caseOutcome: profile.case_outcome,
    },
    ctx.llm,
  );

  const mode = await effectiveApprovalMode(ctx, profile, record.source_id);
  const planAllowsAuto = PLANS[profile.plan].automatedRemoval;
  // Free plans get guided manual removal only; paused providers never automate.
  const automatable =
    planAllowsAuto && (plan.automation === "AUTOMATED" || plan.automation === "SEMI_AUTOMATED") && !actx.source.automationPaused;
  const autoOk =
    mode === "AUTOMATIC" &&
    planAllowsAuto &&
    !!profile.blanket_authorization_at &&
    automatable &&
    !profile.flagged_for_review &&
    (record.match_confidence >= MATCH_THRESHOLDS.STRONG || record.user_confirmed === true);

  let status: RemovalRequestStatus;
  let userAction: RequestRow["user_action"] = null;
  // What we tell the user about why this is (or isn't) automated.
  let explanation = plan.explanation;
  if (arrestPathway) {
    // Arrest-related requests are always sent by the person themselves.
    status = "REQUIRES_USER_ACTION";
    explanation = top.why;
    userAction =
      top.pathway === "NEWS_UPDATE_REQUEST"
        ? {
            kind: "MANUAL_OPT_OUT",
            title: "Ask the publisher to update the article",
            message: top.why,
            instructions: [
              "Find the outlet's corrections, standards or \"contact the newsroom\" page (often linked in the site footer).",
              "Send the request letter from the request preview. You can edit it first.",
              "If you have court paperwork showing the outcome, offer it. Only share what you're comfortable sharing.",
              "Tell us when you've sent it. We'll re-check the article.",
            ],
            choices: ["done", "skip"],
            resume: "manual",
          }
        : {
            kind: "MANUAL_OPT_OUT",
            title: "Request removal of the booking photo",
            message: top.why,
            url: actx.source.optOutUrl,
            instructions: [
              "Look for a \"removal\", \"opt-out\", \"privacy\" or \"contact\" link on the site (often in the footer).",
              "Send the request letter from the request preview. You can edit it first.",
              "Don't pay a removal fee before checking your state's law on booking-photo sites.",
              "Tell us when you've sent it. We'll re-check the page.",
            ],
            choices: ["done", "skip"],
            resume: "manual",
          };
  } else if (mode === "MANUAL" || !automatable) {
    status = "REQUIRES_USER_ACTION";
    const couldAutomate = plan.automation === "AUTOMATED" || plan.automation === "SEMI_AUTOMATED";
    if (couldAutomate && mode === "MANUAL") explanation = "You chose manual mode for this provider, so we've prepared the steps for you to follow.";
    else if (couldAutomate && !planAllowsAuto) explanation = "Automated submission for this provider is available on paid plans. Here's how to do it yourself.";
    else if (actx.source.automationPaused) explanation = "Automation for this provider is paused while we review it. You can complete the opt-out yourself.";
    const emailSteps = actx.source.privacyContactEmail
      ? [
          `Email ${actx.source.privacyContactEmail} from your own address.`,
          "Copy the request text from the request preview (you can edit it first).",
          "Tell us when you've sent it so we can verify the removal.",
        ]
      : null;
    userAction = prepared.manualAction
      ? { ...prepared.manualAction, resume: "manual" }
      : {
          kind: "MANUAL_OPT_OUT",
          title: `Complete the opt-out on ${actx.source.name}`,
          message: explanation,
          url: actx.source.optOutUrl ?? (actx.source.privacyContactEmail ? `mailto:${actx.source.privacyContactEmail}` : undefined),
          instructions: plan.method === "EMAIL_REQUEST" && emailSteps
            ? emailSteps
            : ["Open the provider's opt-out page.", "Submit a removal request for the listing shown.", "Tell us when you're done so we can verify it."],
          choices: ["done", "skip"],
          resume: "manual",
        };
  } else if (autoOk) status = "APPROVED";
  else status = "AWAITING_APPROVAL";

  const row = await ctx.db.one<{ id: string }>(
    `INSERT INTO removal_requests (profile_id, record_id, source_id, method, pathway, pathway_confidence, pathway_rationale, status,
       approval_mode, recipient, request_subject, request_body_ciphertext, user_action, approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $8 = 'APPROVED' THEN now() END)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      record.profile_id, record.id, src?.id ?? null, plan.method, top.pathway, top.confidence, top.why, status, mode,
      prepared.recipient, draft.subject, ctx.cipher.encrypt(draft.body, bodyAad(record.profile_id)),
      userAction ? JSON.stringify(userAction) : null,
    ],
  );
  if (!row) throw conflict("A removal request is already open for this exposure.");
  const recordStatus = status === "APPROVED" ? "READY" : status === "AWAITING_APPROVAL" ? "AWAITING_APPROVAL" : "REQUIRES_USER_ACTION";
  await setRecordStatus(ctx, record.id, recordStatus, explanation);
  await audit(ctx, {
    actorId: opts.initiatedBy ?? null,
    actorType: opts.initiatedBy ? "user" : "system",
    action: "removal.planned",
    targetType: "removal_request",
    targetId: row.id,
    metadata: { status, mode, pathway: top.pathway, method: plan.method, sourceId: src?.id ?? null, autoAuthorized: autoOk, draft: draft.generatedBy },
  });
  if (status === "APPROVED") await ctx.queue.enqueue(JobNames.Removal, { requestId: row.id }, { jobId: `removal:${row.id}:0` });
  return row.id;
}

export async function getOwnedRequest(ctx: AppContext, profileId: string, requestId: string): Promise<RequestRow> {
  const r = await ctx.db.one<RequestRow>("SELECT * FROM removal_requests WHERE id = $1 AND profile_id = $2", [requestId, profileId]);
  if (!r) throw notFound("Removal request");
  return r;
}

export async function requestPreview(ctx: AppContext, r: RequestRow) {
  const record = await getRecord(ctx, r.record_id);
  const src = r.source_id ? await getSource(ctx, r.source_id) : undefined;
  const steps = await ctx.db.query<{ step_id: string; type: string; status: string; started_at: Date; finished_at: Date | null; error: string | null }>(
    `SELECT s.step_id, s.type, s.status, s.started_at, s.finished_at, s.error FROM workflow_steps s
     JOIN removal_workflows w ON w.id = s.workflow_id WHERE w.request_id = $1 ORDER BY s.started_at`,
    [r.id],
  );
  const checks = await ctx.db.query<{ outcome: string; method: string; checked_at: Date; kind: string }>(
    "SELECT outcome, method, checked_at, kind FROM verification_checks WHERE request_id = $1 OR (request_id IS NULL AND record_id = $2) ORDER BY checked_at DESC LIMIT 20",
    [r.id, r.record_id],
  );
  return {
    id: r.id,
    recordId: r.record_id,
    status: r.status,
    method: r.method,
    approvalMode: r.approval_mode,
    recipient: r.recipient ?? src?.name ?? record.domain,
    sourceName: src?.name ?? record.domain,
    listingUrl: decryptUrl(ctx, record),
    pathway: { pathway: r.pathway, confidence: r.pathway_confidence, why: r.pathway_rationale },
    subject: r.request_subject,
    body: r.request_body_ciphertext ? ctx.cipher.decrypt(r.request_body_ciphertext, bodyAad(r.profile_id)) : null,
    userAction: r.user_action,
    confirmationRef: r.confirmation_ref,
    attemptCount: r.attempt_count,
    lastError: r.last_error,
    submittedAt: r.submitted_at,
    nextCheckAt: r.next_check_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    timeline: steps.map((s) => ({ step: s.step_id, type: s.type, status: s.status, at: s.finished_at ?? s.started_at, error: s.error })),
    verification: checks,
  };
}

export async function approveRequest(ctx: AppContext, userId: string, profileId: string, requestId: string, edit?: { subject?: string; body?: string }) {
  const r = await getOwnedRequest(ctx, profileId, requestId);
  if (r.status !== "AWAITING_APPROVAL") throw badRequest(`Request cannot be approved in status ${r.status}.`);
  const record = await getRecord(ctx, r.record_id);
  if (record.user_confirmed === false) throw badRequest("You marked this exposure as not you.");
  if (record.match_confidence < MATCH_THRESHOLDS.WEAK) throw badRequest("This match is too weak to act on.");
  const profile = (await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1", [profileId]))!;
  if (profile.flagged_for_review) throw new AppError("UNDER_REVIEW", "This profile is under review. Submissions are paused until it is cleared.", 423);
  if (edit?.body !== undefined && (edit.body.length < 20 || edit.body.length > 5000)) throw badRequest("Request text must be between 20 and 5000 characters.");
  const rl = await ctx.rateLimiter.hit(`removal-submit:${userId}`, 200, 24 * 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Daily submission limit reached.", 429);

  await ctx.db.query(
    `UPDATE removal_requests SET status = 'APPROVED', approved_at = now(), approved_by = $2,
       request_subject = COALESCE($3, request_subject),
       request_body_ciphertext = COALESCE($4, request_body_ciphertext), updated_at = now()
     WHERE id = $1`,
    [r.id, userId, edit?.subject ?? null, edit?.body ? ctx.cipher.encrypt(edit.body, bodyAad(profileId)) : null],
  );
  // Explicit approval also counts as confirming the match.
  await ctx.db.query("UPDATE discovered_records SET user_confirmed = true, status = 'READY', updated_at = now() WHERE id = $1", [r.record_id]);
  await audit(ctx, { actorId: userId, actorType: "user", action: "removal.approved", targetType: "removal_request", targetId: r.id, metadata: { edited: !!edit?.body } });
  await ctx.queue.enqueue(JobNames.Removal, { requestId: r.id }, { jobId: `removal:${r.id}:${r.attempt_count}` });
}

/** User response to an ACTION REQUIRED card. */
export async function respondToAction(
  ctx: AppContext,
  userId: string,
  profileId: string,
  requestId: string,
  choice: "done" | "skip" | "continue_manually",
): Promise<void> {
  const r = await getOwnedRequest(ctx, profileId, requestId);
  if (r.status !== "REQUIRES_USER_ACTION" || !r.user_action) throw badRequest("This request is not waiting for you.");
  await audit(ctx, { actorId: userId, actorType: "user", action: `removal.user_action.${choice}`, targetType: "removal_request", targetId: r.id, metadata: { kind: r.user_action.kind } });

  if (choice === "skip") {
    await ctx.db.query("UPDATE removal_requests SET status = 'CANCELLED', user_action = NULL, completed_at = now(), updated_at = now() WHERE id = $1", [r.id]);
    await setRecordStatus(ctx, r.record_id, "READY", "You skipped this provider. You can start a new request any time.");
    return;
  }
  if (choice === "continue_manually") {
    const src = r.source_id ? await getSource(ctx, r.source_id) : undefined;
    const manual: RequestRow["user_action"] = {
      kind: "MANUAL_OPT_OUT",
      title: `Finish the opt-out on ${src?.name ?? "the website"}`,
      message: "Complete the provider's process yourself, then tell us you're done. We'll verify the result.",
      url: src?.optOutUrl ?? r.user_action.url,
      instructions: ["Open the provider's opt-out page.", "Complete their verification and submit the request.", "Come back and click “I've completed this”."],
      choices: ["done", "skip"],
      resume: "manual",
    };
    await ctx.db.query("UPDATE removal_requests SET user_action = $2, updated_at = now() WHERE id = $1", [r.id, JSON.stringify(manual)]);
    return;
  }
  // done
  if (r.user_action.resume === "next") {
    const wf = await ctx.db.one<{ id: string; current_step: number; context: Record<string, unknown> }>(
      "SELECT id, current_step, context FROM removal_workflows WHERE request_id = $1",
      [r.id],
    );
    if (!wf) throw badRequest("Workflow state not found.");
    const next = markUserStepDone({ currentStep: wf.current_step, context: wf.context, secure: {} }, r.user_action.stepIndex ?? wf.current_step);
    await ctx.db.query("UPDATE removal_workflows SET current_step = $2, state = 'PENDING', paused_reason = NULL, updated_at = now() WHERE id = $1", [wf.id, next.currentStep]);
    await ctx.db.query("UPDATE removal_requests SET status = 'APPROVED', user_action = NULL, updated_at = now() WHERE id = $1", [r.id]);
    await ctx.queue.enqueue(JobNames.Removal, { requestId: r.id }, { jobId: `removal:${r.id}:resume:${next.currentStep}` });
    return;
  }
  // Manual completion: the user submitted the request themselves.
  await markSubmitted(ctx, r, { confirmationRef: null, submittedBy: "user" });
}

export async function retryRequest(ctx: AppContext, userId: string, profileId: string, requestId: string): Promise<string> {
  const r = await getOwnedRequest(ctx, profileId, requestId);
  if (!["FAILED", "CANCELLED", "COMPLETED"].includes(r.status)) throw badRequest("Only finished requests can be retried.");
  const record = await getRecord(ctx, r.record_id);
  if (!["FAILED", "REAPPEARED", "READY", "PARTIALLY_REMOVED", "REQUIRES_USER_ACTION", "AWAITING_VERIFICATION"].includes(record.status)) {
    throw badRequest(`Nothing to retry for an exposure in status ${record.status}.`);
  }
  const id = await planRemoval(ctx, r.record_id, { initiatedBy: userId, force: true });
  if (!id) throw badRequest("A new request could not be created.");
  return id;
}

export async function cancelRequest(ctx: AppContext, userId: string, profileId: string, requestId: string): Promise<void> {
  const r = await getOwnedRequest(ctx, profileId, requestId);
  if (!["DRAFT", "AWAITING_APPROVAL", "REQUIRES_USER_ACTION", "APPROVED"].includes(r.status)) throw badRequest("This request can no longer be cancelled.");
  await ctx.db.query("UPDATE removal_requests SET status = 'CANCELLED', completed_at = now(), updated_at = now() WHERE id = $1", [r.id]);
  await setRecordStatus(ctx, r.record_id, "READY", "Request cancelled.");
  await audit(ctx, { actorId: userId, actorType: "user", action: "removal.cancelled", targetType: "removal_request", targetId: r.id });
}

// ---- Execution (RemovalJob) -----------------------------------------------

class DbRecorder implements StepRecorder {
  constructor(
    private readonly ctx: AppContext,
    private readonly workflowId: string,
    private readonly profileId: string,
  ) {}
  async start(index: number, stepId: string, type: string) {
    const row = await this.ctx.db.one<{ id: string }>(
      `INSERT INTO workflow_steps (workflow_id, step_index, step_id, type, status, attempt)
       VALUES ($1, $2, $3, $4, 'RUNNING', 1 + (SELECT count(*) FROM workflow_steps WHERE workflow_id = $1 AND step_index = $2)) RETURNING id`,
      [this.workflowId, index, stepId, type],
    );
    return row!.id;
  }
  async finish(id: string, status: string, output?: Record<string, unknown>, error?: string) {
    await this.ctx.db.query("UPDATE workflow_steps SET status = $2, output = $3, error = $4, finished_at = now() WHERE id = $1", [
      id,
      status,
      JSON.stringify(output ?? {}),
      error ?? null,
    ]);
  }
  async hasUnfinishedAttempt(index: number) {
    return !!(await this.ctx.db.one("SELECT 1 FROM workflow_steps WHERE workflow_id = $1 AND step_index = $2 AND status = 'RUNNING'", [this.workflowId, index]));
  }
  async checkpoint(state: WorkflowRunState) {
    await this.ctx.db.query("UPDATE removal_workflows SET current_step = $2, context = $3, updated_at = now() WHERE id = $1", [
      this.workflowId,
      state.currentStep,
      JSON.stringify({ ...state.context, __secure: this.ctx.cipher.encryptJson(state.secure, `workflow:${this.profileId}`) }),
    ]);
  }
}

async function loadWorkflow(ctx: AppContext, r: RequestRow, sourceId: string | null, configId: string | null, version: number) {
  let wf = await ctx.db.one<{ id: string; current_step: number; context: Record<string, unknown> }>(
    "SELECT id, current_step, context FROM removal_workflows WHERE request_id = $1",
    [r.id],
  );
  if (!wf) {
    wf = (await ctx.db.one(
      `INSERT INTO removal_workflows (request_id, source_id, provider_config_id, definition_version, state)
       VALUES ($1, $2, $3, $4, 'PENDING') RETURNING id, current_step, context`,
      [r.id, sourceId, configId, version],
    ))!;
  }
  const { __secure, ...context } = wf.context as Record<string, unknown> & { __secure?: string };
  const secure = __secure ? ctx.cipher.decryptJson<Record<string, unknown>>(__secure, `workflow:${r.profile_id}`) : {};
  return { id: wf.id, state: { currentStep: wf.current_step, context, secure } as WorkflowRunState };
}

/** Execute (or resume) a removal request. Called by the RemovalJob worker. */
export async function executeRequest(ctx: AppContext, requestId: string): Promise<SubmissionResult["status"] | "SKIPPED"> {
  const claimed = await ctx.db.one<RequestRow>(
    `UPDATE removal_requests SET status = 'IN_PROGRESS', attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'APPROVED' RETURNING *`,
    [requestId],
  );
  if (!claimed) return "SKIPPED"; // not approved, or already being processed
  const r = claimed;
  const record = await getRecord(ctx, r.record_id);
  const profile = (await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1", [r.profile_id]))!;
  if (profile.flagged_for_review) {
    await ctx.db.query("UPDATE removal_requests SET status = 'APPROVED', last_error = 'Profile under review' WHERE id = $1", [r.id]);
    return "SKIPPED";
  }
  const { agent, actx } = await agentContextFor(ctx, record);
  const wf = await loadWorkflow(ctx, r, record.source_id, actx.workflow?.configId ?? null, actx.workflow?.definition.version ?? 0);
  await ctx.db.query("UPDATE removal_workflows SET state = 'RUNNING', updated_at = now() WHERE id = $1", [wf.id]);
  const subject = await loadSubject(ctx, r.profile_id);

  let result: SubmissionResult;
  try {
    result = await agent.submitRequest(actx, {
      record: toAgentRecord(ctx, record),
      subject,
      state: wf.state,
      preAuthorized: !!r.approved_at,
      request: {
        recipient: actx.source.privacyContactEmail ?? null,
        subject: r.request_subject,
        body: r.request_body_ciphertext ? ctx.cipher.decrypt(r.request_body_ciphertext, bodyAad(r.profile_id)) : null,
      },
      recorder: new DbRecorder(ctx, wf.id, r.profile_id),
    });
  } catch (err) {
    result = { status: "FAILED", error: err instanceof Error ? err.message : String(err), code: "AGENT_ERROR", retryable: true, state: wf.state };
  }
  await recordHealth(ctx, record.source_id, result);

  switch (result.status) {
    case "SUBMITTED":
      await ctx.db.query("UPDATE removal_workflows SET state = 'COMPLETED', updated_at = now() WHERE id = $1", [wf.id]);
      await markSubmitted(ctx, r, { confirmationRef: result.confirmationRef ?? null, submittedBy: "agent" });
      return "SUBMITTED";
    case "REQUIRES_USER_ACTION": {
      await ctx.db.query("UPDATE removal_workflows SET state = 'PAUSED_FOR_USER', paused_reason = $2, updated_at = now() WHERE id = $1", [wf.id, result.action.kind]);
      await ctx.db.query("UPDATE removal_requests SET status = 'REQUIRES_USER_ACTION', user_action = $2, updated_at = now() WHERE id = $1", [
        r.id,
        JSON.stringify({ ...result.action, resume: result.resume, stepIndex: result.stepIndex }),
      ]);
      await setRecordStatus(ctx, r.record_id, "REQUIRES_USER_ACTION", result.action.message);
      await notifyProfileOwner(ctx, r.profile_id, {
        kind: "ACTION_REQUIRED",
        severity: "warning",
        title: result.action.title,
        body: result.action.message,
        link: `/removals?id=${r.id}`,
      });
      return "REQUIRES_USER_ACTION";
    }
    case "WAITING":
      await ctx.db.query("UPDATE removal_workflows SET state = 'WAITING', resume_at = $2, updated_at = now() WHERE id = $1", [wf.id, result.resumeAt]);
      await ctx.db.query("UPDATE removal_requests SET status = 'APPROVED', updated_at = now() WHERE id = $1", [r.id]);
      return "WAITING";
    case "NOT_FOUND_AT_SOURCE":
      await ctx.db.query("UPDATE removal_workflows SET state = 'COMPLETED', updated_at = now() WHERE id = $1", [wf.id]);
      await ctx.db.query(
        "UPDATE removal_requests SET status = 'AWAITING_VERIFICATION', next_check_at = $2, last_error = 'Listing not found at source; verifying', updated_at = now() WHERE id = $1",
        [r.id, ctx.clock.now()],
      );
      await setRecordStatus(ctx, r.record_id, "AWAITING_VERIFICATION", "The listing was not found on the site; verifying whether it was removed.");
      await ctx.queue.enqueue(JobNames.Verification, { recordId: r.record_id, requestId: r.id, kind: "POST_SUBMISSION" });
      return "NOT_FOUND_AT_SOURCE";
    case "FAILED": {
      const maxAttempts = 4;
      if (result.retryable && r.attempt_count < maxAttempts) {
        await ctx.db.query("UPDATE removal_requests SET status = 'APPROVED', last_error = $2, updated_at = now() WHERE id = $1", [r.id, result.error]);
        await ctx.db.query("UPDATE removal_workflows SET state = 'PENDING' WHERE id = $1", [wf.id]);
        throw new AppError("RETRYABLE", result.error, 503); // let the queue back off and retry
      }
      await ctx.db.query("UPDATE removal_workflows SET state = 'FAILED', updated_at = now() WHERE id = $1", [wf.id]);
      await ctx.db.query("UPDATE removal_requests SET status = 'FAILED', last_error = $2, completed_at = now(), updated_at = now() WHERE id = $1", [r.id, result.error]);
      await setRecordStatus(ctx, r.record_id, "FAILED", humanError(result.code, result.error));
      await ctx.db.query(
        "INSERT INTO failed_jobs (queue, job_name, job_id, source_id, error, attempts, payload_ref) VALUES ('removal', 'RemovalJob', $1, $2, $3, $4, $5)",
        [r.id, record.source_id, `${result.code}: ${result.error}`, r.attempt_count, JSON.stringify({ requestId: r.id })],
      );
      await notifyProfileOwner(ctx, r.profile_id, {
        kind: "REQUEST_FAILED",
        severity: "critical",
        title: "A removal request failed",
        body: `${actx.source.name}: ${humanError(result.code, result.error)}`,
        link: `/removals?id=${r.id}`,
      });
      return "FAILED";
    }
  }
}

function humanError(code: string, fallback: string): string {
  switch (code) {
    case "LAYOUT_CHANGED":
      return "The provider changed its website, so automation stopped safely. Our team has been alerted.";
    case "SUBMISSION_STATE_UNKNOWN":
      return "We couldn't confirm whether a previous attempt went through, so we stopped to avoid duplicate requests.";
    case "PROVIDER_PAUSED":
      return "Automation for this provider is paused while we review it.";
    case "SUBMISSION_NOT_CONFIRMED":
      return "The provider did not acknowledge the request.";
    default:
      return fallback;
  }
}

async function markSubmitted(ctx: AppContext, r: RequestRow, info: { confirmationRef: string | null; submittedBy: "agent" | "user" }) {
  const src = r.source_id ? await getSource(ctx, r.source_id) : undefined;
  const days = src?.estimatedRemovalTime ?? 7;
  const nextCheck = new Date(ctx.clock.now().getTime() + days * 86_400_000);
  await ctx.db.query(
    `UPDATE removal_requests SET status = 'AWAITING_VERIFICATION', submitted_at = COALESCE(submitted_at, $2), confirmation_ref = COALESCE($3, confirmation_ref),
       user_action = NULL, last_error = NULL, next_check_at = $4, updated_at = now() WHERE id = $1`,
    [r.id, ctx.clock.now(), info.confirmationRef, nextCheck],
  );
  await setRecordStatus(ctx, r.record_id, "AWAITING_VERIFICATION", `Request submitted${info.submittedBy === "user" ? " by you" : ""}. We'll verify after about ${days} day(s).`);
  await ctx.queue.enqueue(
    JobNames.Verification,
    { recordId: r.record_id, requestId: r.id, kind: "POST_SUBMISSION" },
    { delayMs: days * 86_400_000, jobId: `verify:${r.id}:${r.attempt_count}` },
  );
  await audit(ctx, { actorType: info.submittedBy === "agent" ? "worker" : "user", action: "removal.submitted", targetType: "removal_request", targetId: r.id, metadata: { by: info.submittedBy, sourceId: r.source_id } });
  await notifyProfileOwner(ctx, r.profile_id, {
    kind: "REQUEST_SUBMITTED",
    severity: "info",
    title: `${src?.name ?? "Removal"} — request submitted`,
    body: `We'll check back in about ${days} day(s) to verify the removal.`,
    link: `/removals?id=${r.id}`,
  });
}

async function recordHealth(ctx: AppContext, sourceId: string | null, result: SubmissionResult) {
  if (!sourceId) return;
  // Only automation outcomes count toward provider health; user pauses are expected.
  if (result.status === "SUBMITTED") await ctx.db.query("INSERT INTO provider_health_events (source_id, kind) VALUES ($1, 'RUN_SUCCEEDED')", [sourceId]);
  if (result.status === "FAILED" && result.code !== "PROVIDER_PAUSED") {
    await ctx.db.query("INSERT INTO provider_health_events (source_id, kind, detail) VALUES ($1, 'RUN_FAILED', $2)", [sourceId, result.code]);
  }
}

// ---- Relay inbox & search verification adapters ----------------------------

function inboxReader(ctx: AppContext, profileId: string) {
  return {
    async find(params: { since: Date; fromDomains: string[]; pattern: RegExp }) {
      const rows = await ctx.db.query<{ id: string; from_domain: string; body_ciphertext: string; received_at: Date }>(
        `SELECT id, from_domain, body_ciphertext, received_at FROM inbound_emails
         WHERE profile_id = $1 AND consumed_at IS NULL AND received_at >= $2::timestamptz - interval '5 minutes' AND from_domain = ANY($3)
         ORDER BY received_at`,
        [profileId, params.since, params.fromDomains],
      );
      for (const row of rows) {
        const body = ctx.cipher.decrypt(row.body_ciphertext, `inbound:${profileId}`);
        if (params.pattern.test(body)) return { id: row.id, fromDomain: row.from_domain, body, receivedAt: row.received_at };
      }
      return undefined;
    },
    async consume(id: string) {
      await ctx.db.query("UPDATE inbound_emails SET consumed_at = now() WHERE id = $1", [id]);
    },
  };
}

function searchVerifier(ctx: AppContext) {
  return {
    async isUrlListed(engine: string, query: string, url: string): Promise<boolean | null> {
      const provider = ctx.searchProviders.find((p) => p.id === engine);
      if (!provider) return null;
      try {
        const { canonicalUrl } = await import("../../../core/normalize");
        const results = await provider.search(query);
        return results.some((r) => canonicalUrl(r.url) === canonicalUrl(url));
      } catch {
        return null;
      }
    },
  };
}

export async function listRequests(ctx: AppContext, profileId: string, status?: string) {
  const rows = await ctx.db.query<RequestRow & { source_name: string | null; domain: string; record_status: string }>(
    `SELECT r.*, s.name AS source_name, d.domain, d.status AS record_status FROM removal_requests r
     JOIN discovered_records d ON d.id = r.record_id LEFT JOIN data_sources s ON s.id = r.source_id
     WHERE r.profile_id = $1 AND ($2::text[] IS NULL OR r.status = ANY($2)) ORDER BY r.updated_at DESC LIMIT 200`,
    [profileId, status ? status.split(",") : null],
  );
  return rows.map((r) => ({
    id: r.id,
    recordId: r.record_id,
    sourceName: r.source_name ?? r.domain,
    status: r.status,
    recordStatus: r.record_status,
    method: r.method,
    approvalMode: r.approval_mode,
    pathway: r.pathway,
    userAction: r.user_action,
    confirmationRef: r.confirmation_ref,
    submittedAt: r.submitted_at,
    nextCheckAt: r.next_check_at,
    lastError: r.last_error,
    updatedAt: r.updated_at,
  }));
}

export type { PoolClient };
