"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

interface V { id: string; version: number; status: string; definition: unknown; changelog: string | null; created_at: string; activated_at: string | null }

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const v = useFetch<{ versions: V[] }>(`/admin/providers/${id}/workflows`);
  const [draft, setDraft] = useState("");
  const [changelog, setChangelog] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const latest = v.data?.versions[0];
    if (latest && !draft) setDraft(JSON.stringify(latest.definition, null, 2));
  }, [v.data, draft]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof r === "object" && r && "summary" in r ? `${ok}: ${(r as { summary: string }).summary}` : ok });
      await v.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <h1>Workflows · <span className="mono">{id}</span></h1>
      {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      <section className="card">
        <div className="card-title">Versions</div>
        {!v.data?.versions.length ? (
          <p className="muted">No structured workflow — this provider uses a code agent or guided manual removal.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Version</th><th>Status</th><th>Changelog</th><th /></tr></thead>
            <tbody>
              {v.data.versions.map((x) => (
                <tr key={x.id}>
                  <td>v{x.version}</td>
                  <td><span className={`badge ${x.status === "ACTIVE" ? "green" : x.status === "DISABLED" ? "red" : "gray"}`}>{x.status.toLowerCase()}</span></td>
                  <td className="small muted">{x.changelog}</td>
                  <td className="row" style={{ gap: 6 }}>
                    {x.status !== "ACTIVE" && <button className="btn sm" onClick={() => void run(() => api(`/admin/providers/${id}/workflows/${x.version}/activate`, { body: {} }), `Activated v${x.version}`)}>Activate</button>}
                    {x.status !== "DISABLED" && <button className="btn ghost sm" onClick={() => void run(() => api(`/admin/providers/${id}/workflows/${x.version}/disable`, { body: {} }), `Disabled v${x.version}`)}>Disable</button>}
                    <button className="btn ghost sm" onClick={() => setDraft(JSON.stringify(x.definition, null, 2))}>Load</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>New draft version</h2>
        <p className="small muted">Drafts never run until activated. Workflows may only use documented step types; the engine never bypasses CAPTCHAs, logins or rate limits.</p>
        <textarea className="input mono" style={{ minHeight: 360 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <input className="input" style={{ marginTop: 8 }} placeholder="Changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            onClick={() =>
              void run(async () => api(`/admin/providers/${id}/workflows`, { body: { definition: JSON.parse(draft), changelog: changelog || "Manual edit" } }), "Draft created")
            }
          >
            Save as draft
          </button>
          <button className="btn" onClick={() => void run(() => api(`/admin/providers/${id}/workflows/propose`, { body: { note: changelog || "Layout changed" } }), "AI draft proposed")}>
            Ask AI to propose a fix
          </button>
        </div>
      </section>
    </>
  );
}
