"use client";

import { Card, PageHeader, Spinner, Stat } from "@/components/ui";
import { withProfile } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Summary {
  generatedAt: string;
  initialExposures: number;
  removed: number;
  pending: number;
  failed: number;
  noActionAvailable: number;
  reappeared: number;
  currentExposure: number;
  outcomes: { removedFromSource: number; removedFromSearchResults: number; noLongerDetected: number };
  privacyScore: number;
  bySource: Array<{ source: string; total: number; removed: number }>;
}

export default function ReportsPage() {
  const { profile } = useSession();
  const r = useApi<Summary>("/reports/summary");
  return (
    <>
      <PageHeader
        title="Privacy report"
        subtitle={r.data ? `Generated ${fmtDate(r.data.generatedAt)}` : undefined}
        actions={
          <>
            <a className="btn" href={`/api${withProfile("/reports/export.csv", profile?.id)}`}>Export CSV</a>
            <a className="btn primary" href={`/api${withProfile("/reports/export.pdf", profile?.id)}`}>Download PDF</a>
          </>
        }
      />
      {!r.data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid cols-4">
            <Stat label="Initial exposures" value={r.data.initialExposures} />
            <Stat label="Removed" value={r.data.removed} tone="green" />
            <Stat label="Pending" value={r.data.pending} tone="blue" />
            <Stat label="Failed" value={r.data.failed} tone={r.data.failed ? "red" : undefined} />
            <Stat label="No action available" value={r.data.noActionAvailable} tone="gray" />
            <Stat label="Current exposure" value={`${r.data.currentExposure}`} hint="results" />
          </div>
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <Card title="What “removed” means">
              <dl className="kv">
                <dt>Removed from source</dt><dd>{r.data.outcomes.removedFromSource} — the page is gone from the website</dd>
                <dt>Removed from search</dt><dd>{r.data.outcomes.removedFromSearchResults} — no longer in search results</dd>
                <dt>No longer detected</dt><dd>{r.data.outcomes.noLongerDetected} — page loads, your data isn&apos;t on it</dd>
              </dl>
            </Card>
            <Card title="By source">
              <table className="table">
                <thead><tr><th>Source</th><th>Removed</th></tr></thead>
                <tbody>
                  {r.data.bySource.map((b) => (
                    <tr key={b.source}><td>{b.source}</td><td>{b.removed} / {b.total}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
