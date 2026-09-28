import type { UserAction, VerificationOutcome } from "../../shared/domain";
import type { HttpClient } from "./browser";

/** Flattened, template-friendly view of the subject. Lives only in memory. */
export interface TemplateSubject {
  name: string;
  firstName: string;
  lastName: string;
  city: string;
  region: string;
  email: string;
  contactEmail: string;
  phone: string;
  /** True when contactEmail is a service-managed relay alias we can read. */
  contactIsRelay: boolean;
}

export interface RunScope {
  base: string;
  sourceDomain: string;
  subject: TemplateSubject;
  record: { url: string };
  /** Persisted as plain JSON — must not contain personal data. */
  context: Record<string, unknown>;
  /** Persisted encrypted. */
  secure: Record<string, unknown>;
}

export interface InboxMessage {
  id: string;
  fromDomain: string;
  body: string;
  receivedAt: Date;
}

export interface InboxReader {
  find(params: { since: Date; fromDomains: string[]; pattern: RegExp }): Promise<InboxMessage | undefined>;
  consume(id: string): Promise<void>;
}

export interface OutboundMailer {
  send(msg: { to: string; subject: string; text: string; replyTo?: string }): Promise<{ messageId: string }>;
}

export interface ApprovedRequestContent {
  recipient?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface StepDeps {
  http: HttpClient;
  now(): Date;
  /** User gave blanket authorization or explicitly approved this request. */
  preAuthorized: boolean;
  sourceName: string;
  optOutUrl?: string;
  inbox?: InboxReader;
  mailer?: OutboundMailer;
  request?: ApprovedRequestContent;
  verifyRemoval?: () => Promise<{ outcome: VerificationOutcome; found: boolean | null }>;
}

export type StepResult =
  | { status: "OK"; output?: Record<string, unknown> }
  | { status: "SKIP"; reason: string }
  | { status: "PAUSE"; action: UserAction; resume: "next" | "manual" }
  | { status: "WAIT"; until: Date; advance: boolean; output?: Record<string, unknown> }
  | { status: "FAIL"; error: string; code: string; retryable: boolean };

export interface WorkflowRunState {
  currentStep: number;
  context: Record<string, unknown>;
  secure: Record<string, unknown>;
}

export type RunOutcome =
  | { kind: "COMPLETED"; state: WorkflowRunState }
  | { kind: "PAUSED_FOR_USER"; state: WorkflowRunState; action: UserAction; resume: "next" | "manual"; stepIndex: number }
  | { kind: "WAITING"; state: WorkflowRunState; resumeAt: Date; stepIndex: number }
  | { kind: "FAILED"; state: WorkflowRunState; error: string; code: string; retryable: boolean; stepIndex: number };

/** Persistence hooks; implemented against PostgreSQL by the worker. */
export interface StepRecorder {
  start(stepIndex: number, stepId: string, type: string): Promise<string>;
  finish(recordId: string, status: "SUCCEEDED" | "PAUSED" | "WAITING" | "FAILED" | "SKIPPED", output?: Record<string, unknown>, error?: string): Promise<void>;
  /** True if a previous attempt of this step started but never finished (crash mid-step). */
  hasUnfinishedAttempt(stepIndex: number): Promise<boolean>;
  checkpoint(state: WorkflowRunState): Promise<void>;
}
