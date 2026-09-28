"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ActionCard, type UserAction } from "@/components/ActionCard";
import { RequestPreview } from "@/components/RequestPreview";
import { Card, Empty, PageHeader, Spinner, StatusBadge, Tabs } from "@/components/ui";
import { PATHWAY, REQUEST_STATUS, fmtDate, fmtRelative } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface Req {
  id: string;
  recordId: string;
  sourceName: string;
  status: string;
  method: string;
  approvalMode: string;
  pathway: string;
  userAction: UserAction | null;
  confirmationRef: string | null;
  submittedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

type Tab = "attention" | "active" | "done" | "all";
const FILTERS: Record<Tab, string[] | null> = {
  attention: ["AWAITING_APPROVAL", "REQUIRES_USER_ACTION"],
  active: ["APPROVED", "IN_PROGRESS", "SUBMITTED", "AWAITING_VERIFICATION"],
  done: ["COMPLETED", "FAILED", "CANCELLED"],
  all: null,
};

function RemovalsInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("attention");
  const [open, setOpen] = useState<string | null>(params.get("id"));
  const reqs = useApi<{ requests: Req[] }>("/removals", { pollMs: 15_000 });
  const all = reqs.data?.requests ?? [];
  const filter = FILTERS[tab];
  const shown = filter ? all.filter((r) => filter.includes(r.status)) : all;
  const count = (t: Tab) => (FILTERS[t] ? all.filter((r) => FILTERS[t]!.includes(r.status)).length : all.length);

  return (
    <>
      <PageHeader title="Removals" subtitle="Every request, what happened, and what happens next." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "attention", label: `Needs you (${count("attention")})` },
          { id: "active", label: `In progress (${count("active")})` },
          { id: "done", label: `Finished (${count("done")})` },
          { id: "all", label: "All" },
        ]}
      />
      {!reqs.data ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Card><Empty title="Nothing here">{tab === "attention" ? "You're all caught up." : "No requests in this state."}</Empty></Card>
      ) : (
        <div className="stack">
          {tab === "attention" &&
            shown.filter((r) => r.status === "REQUIRES_USER_ACTION" && r.userAction).map((r) => (
              <ActionCard key={r.id} requestId={r.id} sourceName={r.sourceName} action={r.userAction!} onDone={() => void reqs.reload()} />
            ))}
          <Card>
            <table className="table">
              <thead>
                <tr><th>Provider</th><th>Pathway</th><th>Status</th><th>Submitted</th><th>Next check</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.sourceName}</strong><div className="small faint">{r.method.replace(/_/g, " ").toLowerCase()} · {r.approvalMode.replace(/_/g, " ").toLowerCase()}</div></td>
                    <td className="small">{PATHWAY[r.pathway] ?? r.pathway}</td>
                    <td>
                      <StatusBadge map={REQUEST_STATUS} status={r.status} />
                      {r.lastError && <div className="small tone-red" style={{ marginTop: 4 }}>{r.lastError}</div>}
                    </td>
                    <td className="small muted">{r.submittedAt ? fmtDate(r.submittedAt) : "—"}{r.confirmationRef && <div className="mono faint">{r.confirmationRef}</div>}</td>
                    <td className="small muted">{r.nextCheckAt ? fmtRelative(r.nextCheckAt) : "—"}</td>
                    <td><button className="btn sm" onClick={() => setOpen(r.id)}>{r.status === "AWAITING_APPROVAL" ? "Review" : "Details"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      <RequestPreview requestId={open} onClose={() => setOpen(null)} onChanged={() => void reqs.reload()} />
    </>
  );
}

export default function RemovalsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RemovalsInner />
    </Suspense>
  );
}
