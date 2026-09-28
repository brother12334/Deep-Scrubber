"use client";

import { useFetch } from "@/lib/useFetch";

type Metrics = Record<string, number> & { verificationOutcomes30d: Record<string, number> };

const LABELS: Array<[string, string, string?]> = [
  ["users", "Users"],
  ["profiles", "Profiles"],
  ["flagged_profiles", "Profiles under review", "amber"],
  ["scans_24h", "Scans (24h)"],
  ["records", "Discovered records"],
  ["removed", "Verified removed", "green"],
  ["reappeared", "Reappeared", "red"],
  ["removals_in_flight", "Removals in flight", "blue"],
  ["removals_waiting_on_users", "Waiting on users", "amber"],
  ["removals_failed_7d", "Failed (7d)", "red"],
  ["unresolved_failed_jobs", "Unresolved failed jobs", "red"],
  ["open_abuse_reports", "Open abuse reports", "amber"],
  ["paused_providers", "Paused providers", "amber"],
];

export default function Overview() {
  const m = useFetch<Metrics>("/admin/metrics");
  if (!m.data) return <div className="muted">Loading…</div>;
  return (
    <>
      <h1>System overview</h1>
      <p className="muted">Aggregate metrics only.</p>
      <div className="grid cols-4">
        {LABELS.map(([k, label, tone]) => (
          <div key={k} className="card">
            <div className="card-title">{label}</div>
            <div className={`stat-value ${tone && m.data![k] ? `tone-${tone}` : ""}`}>{m.data![k] ?? 0}</div>
          </div>
        ))}
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Verification outcomes (30 days)</div>
        <table className="table">
          <tbody>
            {Object.entries(m.data.verificationOutcomes30d).map(([k, v]) => (
              <tr key={k}><td>{k.replace(/_/g, " ").toLowerCase()}</td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
