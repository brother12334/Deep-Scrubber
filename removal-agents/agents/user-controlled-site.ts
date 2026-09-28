import type { SubjectProfile } from "../../core/subject";
import type { AgentContext, AgentRecord, PreparedRequest, RemovalPlan, SubmissionResult, SubmitInput } from "../types";
import { BaseAgent } from "./base";

/** Technical remediation checklist for pages on domains the user controls (spec §9). */
export const SITE_OWNER_INSTRUCTIONS = [
  "Remove the personal information from the page, or delete the page and return HTTP 404 or 410.",
  'If the page must stay online, add <meta name="robots" content="noindex"> or the header "X-Robots-Tag: noindex".',
  "Do not block the page in robots.txt until it has dropped out of search — crawlers must see the noindex.",
  "Remove the URL from your sitemap.xml.",
  "If duplicates exist, point rel=canonical at the version you want indexed.",
  "Ask search engines to re-crawl (e.g. via their webmaster tools) so the change is picked up sooner.",
];

export class UserControlledSiteAgent extends BaseAgent {
  readonly key = "user-controlled-site";

  getRemovalMethod(): RemovalPlan {
    return { method: "USER_CONTROLLED_SITE", automation: "USER_ACTION_REQUIRED", explanation: "You control this website, so you can remove or de-index the page yourself." };
  }

  createRequest(_ctx: AgentContext, record: AgentRecord, _subject: SubjectProfile): PreparedRequest {
    return {
      method: "USER_CONTROLLED_SITE",
      recipient: "Your website",
      fieldsShared: ["Nothing is sent — these are changes you make on your own site."],
      manualAction: {
        kind: "SITE_OWNER_CHANGE",
        title: "Update your website",
        message: `This page is on a domain you control (${safeHost(record.url)}).`,
        instructions: SITE_OWNER_INSTRUCTIONS,
        choices: ["done", "skip"],
      },
    };
  }

  async submitRequest(ctx: AgentContext, input: SubmitInput): Promise<SubmissionResult> {
    const p = this.createRequest(ctx, input.record, input.subject);
    return { status: "REQUIRES_USER_ACTION", action: p.manualAction!, resume: "manual", stepIndex: 0, state: input.state };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "your site";
  }
}
