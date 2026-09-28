"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, withProfile } from "@/lib/api";
import { fmtDate, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Scan {
  id: string;
  trigger: string;
  status: string;
  stats: { queries?: number; retained?: number; newRecords?: number; reappeared?: number; discardedLowConfidence?: number; siteSearches?: number; score?: number };
  created_at: string;
  finished_at: string | null;
}

const SCAN_STATUS = {
  QUEUED: { label: "Queued", tone: "blue" as const },
  RUNNING: { label: "Scanning", tone: "blue" as const },
  COMPLETED: { label: "Completed", tone: "green" as const },
  FAILED: { label: "Failed", tone: "red" as const },
};

export default function ScanPage() {
  const { profile, me } = useSession();
  const scans = useApi<{ scans: Scan[] }>("/scans", { pollMs: 4000 });
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const running = scans.data?.scans.find((s) => s.status === "QUEUED" || s.status === "RUNNING");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api(withProfile("/scans", profile?.id), { body: {} });
      await scans.reload();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Scan" subtitle="Discover where your information is publicly exposed." />
      <Card>
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>{running ? "Scan in progress…" : "Start a new scan"}</h2>
            <div className="muted small">
              We query authorized search APIs and the public search pages of supported data brokers, using only the identifiers on your profile.
              Results that probably belong to someone else are discarded, not stored.
            </div>
          </div>
          <button className="btn primary" disabled={!!running || busy || !!me?.mustVerifyEmail} onClick={() => void start()}>
            {running ? "Scanning…" : "Start scan"}
          </button>
        </div>
        {running && (
          <div style={{ marginTop: 16 }}>
            <div className="bar"><span style={{ width: running.status === "RUNNING" ? "60%" : "15%" }} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>Discover → match → classify → prioritize. You can leave this page; we&apos;ll notify you.</div>
          </div>
        )}
        <ErrorNote error={error} />
      </Card>

      <Card title="Scan history" className="fade-in" >
        {!scans.data ? (
          <Spinner />
        ) : scans.data.scans.length === 0 ? (
          <Empty title="No scans yet" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Status</th><th>Found</th><th>New</th><th>Discarded (not you)</th></tr>
            </thead>
            <tbody>
              {scans.data.scans.map((s) => (
                <tr key={s.id}>
                  <td title={fmtDate(s.created_at)}>{fmtRelative(s.created_at)}</td>
                  <td className="muted">{s.trigger.toLowerCase()}</td>
                  <td><StatusBadge map={SCAN_STATUS} status={s.status} /></td>
                  <td>{s.stats.retained ?? "—"}</td>
                  <td>{s.stats.newRecords ?? "—"}{s.stats.reappeared ? <span className="tone-red"> (+{s.stats.reappeared} reappeared)</span> : null}</td>
                  <td className="muted">{s.stats.discardedLowConfidence ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scans.data?.scans.some((s) => s.status === "COMPLETED") && (
          <div style={{ marginTop: 12 }}><Link href="/exposures">Review exposures →</Link></div>
        )}
      </Card>
    </>
  );
}
