"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionCard, type UserAction } from "@/components/ActionCard";
import { ExposureMap, type MapData } from "@/components/ExposureMap";
import { Icon } from "@/components/icons";
import { ScoreRing } from "@/components/ScoreRing";
import { Card, Empty, ErrorNote, PageHeader, Spinner, Stat } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface Dashboard {
  score: {
    value: number;
    factors: Array<{ key: string; label: string; count: number; pointsEach: number; points: number }>;
    counts: { publicRecords: number; dataBrokers: number; publicProfiles: number; searchResultsRequiringAction: number; highPriority: number };
    lastChange: { delta: number; reasons: string[] } | null;
  };
  cards: { activeRemovals: number; removed: number; requiresAction: number; reappeared: number; needsReview: number };
  actionsRequired: Array<{ requestId: string; sourceName: string; action: UserAction }>;
  recentActivity: Array<{ kind: string; severity: string; title: string; body: string; link: string | null; created_at: string }>;
  lastScan: { status: string; created_at: string; finished_at: string | null } | null;
}

const ACTIVITY_ICON: Record<string, { icon: keyof typeof Icon; tone: string }> = {
  REMOVED: { icon: "check", tone: "green" },
  REQUEST_SUBMITTED: { icon: "check", tone: "blue" },
  ACTION_REQUIRED: { icon: "warn", tone: "amber" },
  NEW_EXPOSURE: { icon: "warn", tone: "amber" },
  REAPPEARED: { icon: "cycle", tone: "red" },
  REQUEST_FAILED: { icon: "warn", tone: "red" },
  SCAN_COMPLETED: { icon: "scan", tone: "gray" },
};

export default function DashboardPage() {
  const d = useApi<Dashboard>("/dashboard", { pollMs: 30_000 });
  const map = useApi<MapData>("/exposures/map");
  const [showFactors, setShowFactors] = useState(false);

  if (d.error) return <ErrorNote error={d.error} />;
  if (!d.data) return <Spinner />;
  const { score, cards } = d.data;
  const neverScanned = !d.data.lastScan;

  return (
    <>
      <PageHeader
        title="Your privacy"
        subtitle={d.data.lastScan ? `Last scan ${fmtRelative(d.data.lastScan.finished_at ?? d.data.lastScan.created_at)}` : "No scans yet"}
        actions={<Link href="/scan" className="btn primary">{neverScanned ? "Run your first scan" : "Scan again"}</Link>}
      />

      <div className="grid dash-top">
        <Card title="Privacy score">
          <div className="row score-row">
            <ScoreRing score={score.value} />
            <div className="stack small" style={{ gap: 4 }}>
              <div>Public records found: <strong>{score.counts.publicRecords}</strong></div>
              <div>Data brokers: <strong>{score.counts.dataBrokers}</strong></div>
              <div>Public profiles: <strong>{score.counts.publicProfiles}</strong></div>
              <div>Search results: <strong>{score.counts.searchResultsRequiringAction}</strong></div>
              <div>High-priority: <strong className={score.counts.highPriority ? "tone-red" : ""}>{score.counts.highPriority}</strong></div>
            </div>
          </div>
          {score.lastChange && score.lastChange.delta !== 0 && (
            <div className={`small ${score.lastChange.delta > 0 ? "tone-green" : "tone-red"}`} style={{ marginTop: 12 }}>
              {score.lastChange.delta > 0 ? "▲" : "▼"} {Math.abs(score.lastChange.delta)} since last change: {score.lastChange.reasons.join("; ")}
            </div>
          )}
          <button className="btn ghost sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setShowFactors((s) => !s)}>
            {showFactors ? "Hide" : "How is this calculated?"}
          </button>
          {showFactors && (
            <div className="small muted stack" style={{ gap: 4 }}>
              <div>Starts at 100. Each active exposure subtracts points by priority:</div>
              {score.factors.length === 0 && <div>No active exposures.</div>}
              {score.factors.map((f) => (
                <div key={f.key} className="row between">
                  <span>{f.count} × {f.label.toLowerCase()} ({f.pointsEach} each)</span>
                  <span className="mono">{f.points}</span>
                </div>
              ))}
              <div className="faint">This is a transparent tally, not a security rating.</div>
            </div>
          )}
        </Card>

        <div className="grid stat-grid">
          <Stat label="Active removals" value={cards.activeRemovals} tone="blue" />
          <Stat label="Removed" value={cards.removed} tone="green" />
          <Stat label="Requires action" value={cards.requiresAction} tone={cards.requiresAction ? "amber" : undefined} hint={cards.needsReview ? `${cards.needsReview} match(es) to review` : undefined} />
          <Stat label="Reappeared" value={cards.reappeared} tone={cards.reappeared ? "red" : undefined} />
        </div>
      </div>

      {d.data.actionsRequired.length > 0 && (
        <div className="stack" style={{ marginTop: 20 }}>
          <h2>Needs your attention</h2>
          {d.data.actionsRequired.slice(0, 4).map((a) => (
            <ActionCard key={a.requestId} requestId={a.requestId} sourceName={a.sourceName} action={a.action} onDone={() => void d.reload()} />
          ))}
          {d.data.actionsRequired.length > 4 && <Link href="/removals?status=REQUIRES_USER_ACTION">View all {d.data.actionsRequired.length}</Link>}
        </div>
      )}

      <div className="stack" style={{ marginTop: 20 }}>
        <Card title="Exposure map">
          {map.data ? <ExposureMap data={map.data} /> : <Spinner />}
        </Card>
        <Card title="Recent activity">
          {d.data.recentActivity.length === 0 ? (
            <Empty title="Nothing yet">Run a scan to see where your information appears.</Empty>
          ) : (
            <div className="list">
              {d.data.recentActivity.map((a, i) => {
                const meta = ACTIVITY_ICON[a.kind] ?? { icon: "check" as const, tone: "gray" };
                const I = Icon[meta.icon];
                return (
                  <div key={i} className="list-item">
                    <span className={`tone-${meta.tone}`}><I /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 550 }}>{a.link ? <Link href={a.link} style={{ color: "inherit" }}>{a.title}</Link> : a.title}</div>
                      <div className="small muted">{a.body}</div>
                    </div>
                    <div className="spacer" />
                    <span className="small faint" style={{ whiteSpace: "nowrap" }}>{fmtRelative(a.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
