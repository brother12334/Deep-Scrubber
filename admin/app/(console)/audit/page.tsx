"use client";

import { useState } from "react";
import { useFetch } from "@/lib/useFetch";

interface E { id: number; actor_user_id: string | null; actor_type: string; action: string; target_type: string | null; target_id: string | null; metadata: unknown; created_at: string }

export default function Audit() {
  const [filter, setFilter] = useState("");
  const a = useFetch<{ entries: E[] }>(`/admin/audit?limit=200${filter ? `&action=${encodeURIComponent(filter)}` : ""}`);
  return (
    <>
      <div className="row between">
        <h1>Audit log</h1>
        <input className="input" style={{ width: 260 }} placeholder="Filter by action prefix (e.g. removal.)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <section className="card">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Metadata</th></tr></thead>
          <tbody>
            {a.data?.entries.map((x) => (
              <tr key={x.id}>
                <td className="small">{new Date(x.created_at).toLocaleString()}</td>
                <td className="small">{x.actor_type}{x.actor_user_id && <div className="mono faint">{x.actor_user_id.slice(0, 8)}</div>}</td>
                <td className="mono small">{x.action}</td>
                <td className="small">{x.target_type}{x.target_id && <div className="mono faint">{x.target_id.slice(0, 8)}</div>}</td>
                <td className="mono small faint" style={{ maxWidth: 320, wordBreak: "break-all" }}>{JSON.stringify(x.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
