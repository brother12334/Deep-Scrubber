"use client";

import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

interface J { id: number; queue: string; job_name: string; job_id: string | null; source_id: string | null; error: string; attempts: number; resolved: boolean; created_at: string }

export default function Jobs() {
  const j = useFetch<{ jobs: J[] }>("/admin/failed-jobs");
  async function act(id: number, what: "retry" | "resolve") {
    await api(`/admin/failed-jobs/${id}/${what}`, { body: {} }).catch((e) => alert((e as Error).message));
    await j.reload();
  }
  return (
    <>
      <h1>Failed jobs</h1>
      <section className="card">
        {!j.data?.jobs.length ? (
          <p className="muted">No unresolved failures.</p>
        ) : (
          <table className="table">
            <thead><tr><th>When</th><th>Job</th><th>Source</th><th>Error</th><th>Attempts</th><th /></tr></thead>
            <tbody>
              {j.data.jobs.map((x) => (
                <tr key={x.id}>
                  <td className="small">{new Date(x.created_at).toLocaleString()}</td>
                  <td className="mono small">{x.job_name}</td>
                  <td className="mono small">{x.source_id ?? "—"}</td>
                  <td className="small tone-red">{x.error}</td>
                  <td>{x.attempts}</td>
                  <td className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => void act(x.id, "retry")}>Retry</button>
                    <button className="btn ghost sm" onClick={() => void act(x.id, "resolve")}>Resolve</button>
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
