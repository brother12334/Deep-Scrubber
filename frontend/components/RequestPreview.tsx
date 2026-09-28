"use client";

import { useEffect, useState } from "react";
import { api, withProfile } from "@/lib/api";
import { OUTCOME, PATHWAY, REQUEST_STATUS, fmtDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ActionCard, type UserAction } from "./ActionCard";
import { Badge, ErrorNote, Modal, Spinner, StatusBadge } from "./ui";

interface Preview {
  id: string;
  status: string;
  method: string;
  recipient: string;
  sourceName: string;
  listingUrl: string;
  pathway: { pathway: string; confidence: string; why: string };
  subject: string | null;
  body: string | null;
  userAction: UserAction | null;
  confirmationRef: string | null;
  lastError: string | null;
  submittedAt: string | null;
  nextCheckAt: string | null;
  timeline: Array<{ step: string; type: string; status: string; at: string; error: string | null }>;
  verification: Array<{ outcome: string; method: string; checked_at: string; kind: string }>;
}

/** REQUEST PREVIEW (spec §10): recipient, request, reason; edit; approve & submit. */
export function RequestPreview({ requestId, onClose, onChanged }: { requestId: string | null; onClose(): void; onChanged?(): void }) {
  const { profile } = useSession();
  const [data, setData] = useState<Preview | null>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = async () => {
    if (!requestId) return;
    try {
      const r = await api<{ request: Preview }>(withProfile(`/removals/${requestId}`, profile?.id));
      setData(r.request);
      setBody(r.request.body ?? "");
    } catch (e) {
      setError(e as Error);
    }
  };
  useEffect(() => {
    setData(null);
    setEditing(false);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function act(path: string, payload: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(withProfile(`/removals/${requestId}/${path}`, profile?.id), { body: payload });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!requestId} onClose={onClose} label="Removal request">
      {!data ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="stack">
          <div className="row between">
            <div className="card-title" style={{ margin: 0 }}>Request preview</div>
            <StatusBadge map={REQUEST_STATUS} status={data.status} />
          </div>
          <div>
            <div className="small faint">Recipient</div>
            <div style={{ fontWeight: 600 }}>{data.recipient}</div>
          </div>
          <div>
            <div className="small faint">Listing</div>
            <div className="mono small" style={{ wordBreak: "break-all" }}>{data.listingUrl}</div>
          </div>
          <div>
            <div className="small faint">Request</div>
            {editing ? (
              <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Request text" />
            ) : (
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, background: "var(--surface-2)", padding: 14, borderRadius: 8, border: "1px solid var(--border)" }}>{data.body}</pre>
            )}
          </div>
          <div>
            <div className="small faint">Potential pathway</div>
            <div className="row">
              <strong>{PATHWAY[data.pathway.pathway] ?? data.pathway.pathway}</strong>
              <Badge tone={data.pathway.confidence === "HIGH" ? "green" : data.pathway.confidence === "MEDIUM" ? "amber" : "gray"} plain>
                Confidence: {data.pathway.confidence.toLowerCase()}
              </Badge>
            </div>
            <div className="muted small">Why: {data.pathway.why}</div>
            <div className="faint small">This is not legal advice.</div>
          </div>

          {data.userAction && <ActionCard requestId={data.id} sourceName={data.sourceName} action={data.userAction} onDone={() => { void load(); onChanged?.(); }} />}
          {data.lastError && <div className="notice err">{data.lastError}</div>}
          {data.confirmationRef && <div className="small muted">Confirmation reference: <span className="mono">{data.confirmationRef}</span></div>}
          {data.nextCheckAt && <div className="small muted">Next verification: {fmtDate(data.nextCheckAt)}</div>}

          {data.timeline.length > 0 && (
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>What happened ({data.timeline.length} steps)</summary>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {data.timeline.map((t, i) => (
                  <li key={i}>
                    <span className="mono">{t.step}</span> — {t.status.toLowerCase()} {t.error ? <span className="tone-red">({t.error})</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.verification.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="small faint">Verification checks</div>
              {data.verification.map((v, i) => (
                <div key={i} className="row small">
                  <StatusBadge map={OUTCOME} status={v.outcome} />
                  <span className="muted">{fmtDate(v.checked_at)}</span>
                </div>
              ))}
            </div>
          )}

          <ErrorNote error={error} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose}>Close</button>
            {data.status === "AWAITING_APPROVAL" && (
              <>
                {!editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
                <button className="btn" disabled={busy} onClick={() => act("cancel")}>Cancel request</button>
                <button className="btn primary" disabled={busy} onClick={() => act("approve", editing ? { body } : {})}>
                  Approve &amp; Submit
                </button>
              </>
            )}
            {["FAILED", "CANCELLED", "COMPLETED"].includes(data.status) && (
              <button className="btn primary" disabled={busy} onClick={() => act("retry")}>Submit removal again</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
