import type { DataSource } from "../providers/registry/types";
import type {
  AutomationStatus,
  DataType,
  DiscoveryMethod,
  ExposureCategory,
  RemovalMethod,
  UserAction,
  VerificationOutcome,
} from "../shared/domain";
import type { CandidateAttributes } from "../core/extract";
import type { MatchResult } from "../core/matching";
import type { SubjectProfile } from "../core/subject";
import type { HttpClient } from "./engine/browser";
import type { WorkflowDefinition } from "./engine/definition";
import type { ApprovedRequestContent, InboxReader, OutboundMailer, StepRecorder, WorkflowRunState } from "./engine/types";

/** Registry entry plus live operational flags from the database. */
export interface SourceRuntime extends DataSource {
  automationPaused: boolean;
  enabled: boolean;
}

export interface SearchVerifier {
  /** Returns true/false if the URL is (not) currently in the engine's results for the query; null if the engine is unavailable. */
  isUrlListed(engine: string, query: string, url: string): Promise<boolean | null>;
}

export interface AgentContext {
  source: SourceRuntime;
  /** Base URL for the source (e.g. https://www.example.com, or the mock broker in dev). */
  baseUrl: string;
  http: HttpClient;
  now(): Date;
  inbox?: InboxReader;
  mailer?: OutboundMailer;
  searchVerifier?: SearchVerifier;
  workflow?: { definition: WorkflowDefinition; configId: string | null };
}

export interface DiscoveredCandidate {
  url: string;
  title?: string;
  text: string;
  html?: string;
  discoveryMethod: DiscoveryMethod;
  sourceId?: string;
  isSearchResult?: boolean;
  searchEngine?: string;
  searchRank?: number;
  searchQuery?: string;
  targetedSearch?: boolean;
}

/** The agent-facing view of a discovered record (decrypted in worker memory). */
export interface AgentRecord {
  id: string;
  url: string;
  sourceId: string | null;
  category: ExposureCategory;
  dataTypes: DataType[];
  isSearchResult: boolean;
  searchEngine: string | null;
  parentUrl?: string | null;
  originGone?: boolean;
}

export interface RemovalPlan {
  method: RemovalMethod;
  automation: AutomationStatus;
  /** Why automation is (not) available, for the UI. */
  explanation: string;
  recipient?: string;
}

export interface PreparedRequest {
  method: RemovalMethod;
  recipient: string;
  /** Plain-language list of what will be sent, for the preview. */
  fieldsShared: string[];
  /** Manual instructions when the user has to act. */
  manualAction?: UserAction;
}

export type SubmissionResult =
  | { status: "SUBMITTED"; confirmationRef?: string; sourceReportsCompleted?: boolean; state: WorkflowRunState }
  | { status: "REQUIRES_USER_ACTION"; action: UserAction; resume: "next" | "manual"; stepIndex: number; state: WorkflowRunState }
  | { status: "WAITING"; resumeAt: Date; state: WorkflowRunState }
  | { status: "NOT_FOUND_AT_SOURCE"; state: WorkflowRunState }
  | { status: "FAILED"; error: string; code: string; retryable: boolean; state: WorkflowRunState };

export interface SubmitInput {
  record: AgentRecord;
  subject: SubjectProfile;
  state: WorkflowRunState;
  preAuthorized: boolean;
  request: ApprovedRequestContent;
  recorder: StepRecorder;
}

export interface VerificationResult {
  found: boolean | null;
  outcome: VerificationOutcome;
  method: string;
  details: Record<string, unknown>;
}

export interface IdentifiedMatch extends MatchResult {
  attributes: CandidateAttributes;
}

/**
 * Site-specific removal agent (spec §6). Adding a data broker means adding
 * a registry entry and — only if the generic agents are insufficient — a
 * class implementing this interface, registered in ./registry.ts.
 */
export interface RemovalAgent {
  readonly key: string;
  discover(ctx: AgentContext, subject: SubjectProfile): Promise<DiscoveredCandidate[]>;
  identifyMatch(subject: SubjectProfile, candidate: DiscoveredCandidate): IdentifiedMatch;
  getRemovalMethod(ctx: AgentContext, record: AgentRecord): RemovalPlan;
  createRequest(ctx: AgentContext, record: AgentRecord, subject: SubjectProfile): PreparedRequest;
  submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult>;
  checkStatus(ctx: AgentContext, state: WorkflowRunState): Promise<{ sourceReportsCompleted: boolean | null }>;
  verifyRemoval(ctx: AgentContext, record: AgentRecord, subject: SubjectProfile): Promise<VerificationResult>;
}
