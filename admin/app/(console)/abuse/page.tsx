"use client";

import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

interface R { id: string; subject_user_id: string | null; category: string; description: string; status: string; source: string; created_at: string }

export default function Abuse() {
  const r = useFetch<{ reports: R[] }>("/admin/abuse-reports");
  async function update(id: string, body: Record<string, unknown>) {
    await api(`/admin/abuse-reports/${id}`, { method: "PATCH", body }).catch((e) => alert((e as Error).message));
    await r.reload();
  }
  return (
    <>
      <h1>Abuse reports</h1>
      <p className="muted small">Automated flags pause automatic submissions for the affected profile until resolved.</p>
      <section className="card">
        {!r.data?.reports.length ? (
          <p className="muted">No reports.</p>
        ) : (
          <table className="table">
            <thead><tr><th>When</th><th>Source</th><th>Category</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>
              {r.data.reports.map((x) => (
                <tr key={x.id}>
                  <td className="small">{new Date(x.created_at).toLocaleDateString()}</td>
                  <td>{x.source}</td>
                  <td className="mono small">{x.category}</td>
                  <td className="small" style={{ maxWidth: 360 }}>{x.description}</td>
                  <td><span className={`badge ${x.status === "OPEN" ? "amber" : x.status === "ACTIONED" ? "red" : "gray"}`}>{x.status.toLowerCase()}</span></td>
                  <td className="stack" style={{ gap: 4 }}>
                    <button className="btn sm" onClick={() => void update(x.id, { status: "INVESTIGATING" })}>Investigate</button>
                    {x.subject_user_id && <button className="btn sm danger" onClick={() => void update(x.id, { status: "ACTIONED", suspendUser: true })}>Suspend user</button>}
                    <button className="btn ghost sm" onClick={() => void update(x.id, { status: "DISMISSED", clearProfileFlag: true })}>Dismiss &amp; clear flag</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
