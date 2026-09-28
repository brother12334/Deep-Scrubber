"use client";

import { useState } from "react";
import { api, withProfile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon } from "./icons";

export interface UserAction {
  kind: string;
  title: string;
  message: string;
  url?: string;
  instructions?: string[];
  choices: Array<"done" | "skip" | "continue_manually" | "upload_document">;
}

const DONE_LABEL: Record<string, string> = {
  EMAIL_VERIFICATION: "I've completed verification",
  CONFIRM_SUBMISSION: "Approve & submit",
  MANUAL_OPT_OUT: "I've completed this",
  SEARCH_ENGINE_FORM: "I've submitted the form",
  SITE_OWNER_CHANGE: "I've updated my site",
};

/** ACTION REQUIRED card (spec §8): automation stopped and needs the user. */
export function ActionCard({ requestId, sourceName, action, onDone }: { requestId: string; sourceName: string; action: UserAction; onDone?(): void }) {
  const { profile } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const human = action.kind === "HUMAN_VERIFICATION" || action.kind === "IDENTITY_DOCUMENT";

  async function respond(choice: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(withProfile(`/removals/${requestId}/action`, profile?.id), { body: { choice } });
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`action-card fade-in ${human ? "human" : ""}`}>
      <div className="action-title">{human ? "Automation paused" : "Action required"}</div>
      <h3 style={{ marginBottom: 4 }}>
        {sourceName} — {action.title}
      </h3>
      <p className="muted" style={{ marginBottom: 6 }}>{action.message}</p>
      {action.instructions && action.instructions.length > 0 && (
        <ol>
          {action.instructions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {err && <div className="error-text">{err}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        {action.url && (
          <a className="btn sm" href={action.url} target="_blank" rel="noopener noreferrer nofollow">
            {action.kind === "EMAIL_VERIFICATION" ? "Open verification email" : "Open provider page"} <Icon.external width={14} height={14} />
          </a>
        )}
        {action.choices.includes("continue_manually") && (
          <button className="btn sm primary" disabled={busy} onClick={() => respond("continue_manually")}>
            Continue manually
          </button>
        )}
        {action.choices.includes("done") && (
          <button className="btn sm primary" disabled={busy} onClick={() => respond("done")}>
            {DONE_LABEL[action.kind] ?? "Done"}
          </button>
        )}
        {action.choices.includes("skip") && (
          <button className="btn sm ghost" disabled={busy} onClick={() => respond("skip")}>
            Skip this provider
          </button>
        )}
      </div>
    </div>
  );
}
