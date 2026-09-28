import { dataTypesFor, extractAttributes, htmlToText } from "../../core/extract";
import { scoreMatch } from "../../core/matching";
import type { SubjectProfile } from "../../core/subject";
import type { WorkflowRunState } from "../engine/types";
import type { TemplateSubject } from "../engine/types";
import { verifyPage } from "../verification";
import type {
  AgentContext,
  AgentRecord,
  DiscoveredCandidate,
  IdentifiedMatch,
  PreparedRequest,
  RemovalAgent,
  RemovalPlan,
  SubmissionResult,
  SubmitInput,
  VerificationResult,
} from "../types";

export function toTemplateSubject(s: SubjectProfile): TemplateSubject {
  const name = s.names[0] ?? "";
  const parts = name.trim().split(/\s+/);
  const loc = s.locations[0];
  const digits = (s.phones[0] ?? "").replace(/\D/g, "").slice(-10);
  return {
    name,
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts[parts.length - 1]! : "",
    city: loc?.city ? loc.city.replace(/\b\w/g, (c) => c.toUpperCase()) : "",
    region: loc?.region?.toUpperCase() ?? "",
    email: s.emails[0] ?? "",
    contactEmail: s.contactEmail ?? s.emails[0] ?? "",
    phone: digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : "",
    contactIsRelay: !!s.contactIsRelay,
  };
}

/** Shared behaviour: deterministic matching and generic page verification. */
export abstract class BaseAgent implements RemovalAgent {
  abstract readonly key: string;

  async discover(_ctx: AgentContext, _subject: SubjectProfile): Promise<DiscoveredCandidate[]> {
    return []; // Most sources are discovered through search providers.
  }

  identifyMatch(subject: SubjectProfile, c: DiscoveredCandidate): IdentifiedMatch {
    const text = c.html ? htmlToText(c.html) : c.text;
    const attributes = extractAttributes(`${c.title ?? ""} ${text}`, subject, { url: c.url, html: c.html });
    return { ...scoreMatch(subject, attributes, { url: c.url, targetedSearch: c.targetedSearch }), attributes };
  }

  abstract getRemovalMethod(ctx: AgentContext, record: AgentRecord): RemovalPlan;
  abstract createRequest(ctx: AgentContext, record: AgentRecord, subject: SubjectProfile): PreparedRequest;
  abstract submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult>;

  async checkStatus(_ctx: AgentContext, state: WorkflowRunState): Promise<{ sourceReportsCompleted: boolean | null }> {
    const v = state.context.sourceReportsCompleted;
    return { sourceReportsCompleted: typeof v === "boolean" ? v : null };
  }

  async verifyRemoval(ctx: AgentContext, record: AgentRecord, subject: SubjectProfile): Promise<VerificationResult> {
    return verifyPage(ctx.http, record.url, subject, record.dataTypes);
  }
}

export { dataTypesFor };
