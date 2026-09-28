"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, withProfile } from "@/lib/api";
import { AUTOMATION, CATEGORY, pct } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Source {
  id: string;
  name: string;
  domain: string;
  categories: string[];
  automationStatus: string;
  automationPaused: boolean;
  requiresEmailVerification: boolean;
  requiresIdentityVerification: boolean;
  estimatedRemovalDays: number;
  reappearsFrequently: boolean;
  optOutUrl: string | null;
  notes: string | null;
  lastVerifiedAt: string | null;
  reliability: { sufficientData: boolean; sampleSize: number; successRate: number | null; averageRemovalDays: number | null; reappearance: string | null };
  approvalMode: string | null;
  recordsFound: number;
}

export default function SourcesPage() {
  const { profile, me } = useSession();
  const s = useApi<{ sources: Source[] }>("/sources");
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function setMode(id: string, approvalMode: string | null) {
    setErr(null);
    try {
      await api(withProfile(`/sources/${id}/preference`, profile?.id), { method: "PUT", body: { approvalMode } });
      await s.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const list = (s.data?.sources ?? [])
    .filter((x) => !filter || `${x.name} ${x.domain}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.recordsFound - a.recordsFound || a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Sources" subtitle="The data brokers, directories and platforms we know how to handle." actions={<input className="input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />} />
      {err && <div className="notice err">{err}</div>}
      {!s.data ? (
        <Spinner />
      ) : (
        <div className="grid cols-2">
          {list.map((x) => (
            <Card key={x.id}>
              <div className="row between">
                <div>
                  <h3 style={{ marginBottom: 0 }}>{x.name}</h3>
                  <div className="small faint">{x.domain} · {x.categories.map((c) => CATEGORY[c] ?? c).join(", ")}</div>
                </div>
                <StatusBadge map={AUTOMATION} status={x.automationStatus} />
              </div>
              {x.automationPaused && <div className="notice warn small" style={{ marginTop: 10 }}>Automation is paused while this provider&apos;s workflow is reviewed.</div>}
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Removal success</dt>
                <dd>{x.reliability.sufficientData ? pct(x.reliability.successRate ?? 0) : <span className="muted">Not enough data yet ({x.reliability.sampleSize} requests)</span>}</dd>
                <dt>Average time</dt>
                <dd>{x.reliability.averageRemovalDays != null ? `${x.reliability.averageRemovalDays} days` : <span className="muted">Typically ~{x.estimatedRemovalDays} days (provider estimate)</span>}</dd>
                <dt>Reappearance</dt>
                <dd>{x.reliability.reappearance ?? (x.reappearsFrequently ? "Known to regenerate records" : "—")}</dd>
                <dt>Requirements</dt>
                <dd className="chips">
                  {x.requiresEmailVerification && <span className="chip">Email confirmation</span>}
                  {x.requiresIdentityVerification && <span className="chip">Identity document</span>}
                  {!x.requiresEmailVerification && !x.requiresIdentityVerification && <span className="muted small">None</span>}
                </dd>
                <dt>Found for you</dt>
                <dd>{x.recordsFound > 0 ? <Badge tone="amber" plain>{x.recordsFound} listing(s)</Badge> : <span className="muted">None</span>}</dd>
              </dl>
              {x.notes && <p className="small faint" style={{ marginTop: 10 }}>{x.notes}</p>}
              <div className="row" style={{ marginTop: 10 }}>
                <select className="input" style={{ width: "auto" }} value={x.approvalMode ?? ""} onChange={(e) => void setMode(x.id, e.target.value || null)} aria-label={`Approval mode for ${x.name}`}>
                  <option value="">Use my default</option>
                  <option value="AUTOMATIC" disabled={me?.plan === "FREE"}>Automatic</option>
                  <option value="APPROVAL_REQUIRED">Approval required</option>
                  <option value="MANUAL">Manual</option>
                </select>
                {x.optOutUrl && <a className="small" href={x.optOutUrl} target="_blank" rel="noopener noreferrer nofollow">Official opt-out page</a>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="small faint" style={{ marginTop: 16 }}>Statistics are based only on this platform&apos;s own historical results and are shown once there is enough data.</p>
    </>
  );
}
