"use client";

import { useEffect, useState } from "react";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, withProfile } from "@/lib/api";
import { RECORD_STATUS, fmtDate, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Mon {
  settings: { intervalDays: number; enabled: boolean };
  jobs: Array<{ id: string; kind: string; record_id: string | null; schedule_step: number; next_run_at: string; last_run_at: string | null; active: boolean; domain: string | null; source_name: string | null; record_status: string | null }>;
}

const SCHEDULE = ["Day 1", "Day 3", "Day 7", "Day 14", "Day 30"];

export default function MonitoringPage() {
  const { profile, me } = useSession();
  const m = useApi<Mon>("/monitoring");
  const [interval, setIntervalDays] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [err, setErr] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (m.data) {
      setIntervalDays(m.data.settings.intervalDays);
      setEnabled(m.data.settings.enabled);
    }
  }, [m.data]);

  async function save() {
    setErr(null);
    setSaved(false);
    try {
      await api(withProfile("/monitoring", profile?.id), { body: { intervalDays: interval, enabled } });
      setSaved(true);
      await m.reload();
    } catch (e) {
      setErr(e as Error);
    }
  }
  async function stop(id: string) {
    await api(withProfile(`/monitoring/${id}`, profile?.id), { method: "DELETE" });
    await m.reload();
  }

  const paid = me?.plan !== "FREE";
  return (
    <>
      <PageHeader title="Monitoring" subtitle="Removed listings are re-checked, and new exposure is discovered continuously." />
      <div className="grid cols-2">
        <Card title="Schedule">
          <p className="muted small">After a removal is verified we re-check it on:</p>
          <div className="chips" style={{ marginBottom: 12 }}>
            {SCHEDULE.map((s) => <span className="chip" key={s}>{s}</span>)}
            <span className="chip">then every {interval} days</span>
          </div>
          <label className="field">
            Re-check and re-scan interval (days)
            <input className="input" type="number" min={1} max={180} value={interval} onChange={(e) => setIntervalDays(Number(e.target.value))} />
          </label>
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={enabled} disabled={!paid} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Continuously re-scan for new exposure {!paid && <span className="badge gray plain">Pro</span>}</span>
          </label>
          <ErrorNote error={err} />
          {saved && <div className="small tone-green">Saved.</div>}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => void save()}>Save</button>
        </Card>
        <Card title="How reappearance works">
          <p className="muted small">
            Data brokers often regenerate records from new data. If a listing we verified as removed shows up again, it&apos;s marked
            <strong className="tone-red"> Reappeared</strong> and you&apos;re notified. In automatic mode we re-submit the opt-out; otherwise you can
            submit it again with one click.
          </p>
        </Card>
      </div>
      <Card title="Active monitors">
        {!m.data ? (
          <Spinner />
        ) : m.data.jobs.filter((j) => j.active).length === 0 ? (
          <Empty title="Nothing monitored yet">Monitors are created automatically when removals are verified.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>What</th><th>Status</th><th>Last check</th><th>Next check</th><th /></tr></thead>
            <tbody>
              {m.data.jobs.filter((j) => j.active).map((j) => (
                <tr key={j.id}>
                  <td>{j.kind === "PROFILE_RESCAN" ? <strong>Full re-scan</strong> : <strong>{j.source_name ?? j.domain}</strong>}<div className="small faint">{j.kind === "RECORD_RECHECK" ? `check ${Math.min(j.schedule_step, 5)} of schedule` : "discovers new exposure"}</div></td>
                  <td>{j.record_status ? <StatusBadge map={RECORD_STATUS} status={j.record_status} /> : "—"}</td>
                  <td className="small muted">{j.last_run_at ? fmtDate(j.last_run_at) : "—"}</td>
                  <td className="small">{fmtRelative(j.next_run_at)}</td>
                  <td>{j.kind === "RECORD_RECHECK" && <button className="btn ghost sm" onClick={() => void stop(j.id)}>Stop</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
