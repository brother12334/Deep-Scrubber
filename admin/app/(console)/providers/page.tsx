"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

interface P {
  id: string;
  name: string;
  domain: string;
  agent: string;
  automationStatus: string;
  automationPaused: boolean;
  enabled: boolean;
  activeWorkflowVersion: number | null;
  lastVerifiedAt?: string;
  health: { failureRate: number; samples: number; shouldPause: boolean };
  reliability: { sufficientData: boolean; successRate: number | null; sampleSize: number };
}

const EMPTY = `{
  "id": "new-broker",
  "name": "New Broker",
  "domain": "newbroker.com",
  "categories": ["PEOPLE_SEARCH"],
  "discoveryMethods": ["SEARCH_API"],
  "removalMethods": ["WEB_FORM"],
  "requiresUserVerification": true,
  "requiresEmailVerification": false,
  "requiresIdentityVerification": false,
  "estimatedRemovalTime": 14,
  "reappearsFrequently": true,
  "supportedRegions": ["US"],
  "automationStatus": "USER_ACTION_REQUIRED",
  "agent": "manual-guidance",
  "optOutUrl": "https://newbroker.com/opt-out"
}`;

export default function Providers() {
  const p = useFetch<{ providers: P[] }>("/admin/providers");
  const [json, setJson] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, body: unknown) {
    setErr(null);
    try {
      await api(path, { body });
      await p.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="row between">
        <h1>Providers</h1>
        <button className="btn sm" onClick={() => void call("/admin/health/evaluate", {})}>Run health check</button>
      </div>
      {err && <div className="notice err">{err}</div>}
      <section className="card">
        <table className="table">
          <thead>
            <tr><th>Provider</th><th>Agent</th><th>Automation</th><th>Workflow</th><th>Health (7d)</th><th>Success</th><th /></tr>
          </thead>
          <tbody>
            {p.data?.providers.map((x) => (
              <tr key={x.id}>
                <td><Link href={`/providers/${x.id}`}><strong>{x.name}</strong></Link><div className="small faint">{x.domain}</div></td>
                <td className="mono small">{x.agent}</td>
                <td>
                  <span className={`badge ${x.automationPaused ? "amber" : x.enabled ? "green" : "gray"}`}>
                    {!x.enabled ? "disabled" : x.automationPaused ? "paused" : x.automationStatus.toLowerCase().replace(/_/g, " ")}
                  </span>
                </td>
                <td>{x.activeWorkflowVersion ? `v${x.activeWorkflowVersion}` : "—"}</td>
                <td className={x.health.shouldPause ? "tone-red" : ""}>{x.health.samples ? `${Math.round(x.health.failureRate * 100)}% fail · ${x.health.samples} runs` : "—"}</td>
                <td>{x.reliability.sufficientData ? `${Math.round((x.reliability.successRate ?? 0) * 100)}%` : <span className="faint">n={x.reliability.sampleSize}</span>}</td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => void call(`/admin/providers/${x.id}/pause`, { paused: !x.automationPaused })}>{x.automationPaused ? "Resume" : "Pause"}</button>
                  <button className="btn ghost sm" onClick={() => void call(`/admin/providers/${x.id}/enabled`, { enabled: !x.enabled })}>{x.enabled ? "Disable" : "Enable"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Add or update a provider</h2>
        <p className="small muted">Registry entries are validated against the DataSource schema. Prefer committing a JSON file to <span className="mono">providers/registry/sources/</span> so changes are reviewed.</p>
        <textarea className="input mono" style={{ minHeight: 320 }} value={json} onChange={(e) => setJson(e.target.value)} />
        <button
          className="btn primary"
          style={{ marginTop: 10 }}
          onClick={() => {
            try {
              void call("/admin/providers", JSON.parse(json));
            } catch {
              setErr("Invalid JSON");
            }
          }}
        >
          Save provider
        </button>
      </section>
    </>
  );
}
