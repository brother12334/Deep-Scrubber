"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { RequestPreview } from "@/components/RequestPreview";
import { Badge, Card, Drawer, Empty, ErrorNote, PageHeader, Spinner, StatusBadge, Tabs } from "@/components/ui";
import { api, withProfile } from "@/lib/api";
import { BAND, CATEGORY, DATA_TYPE, OUTCOME, PATHWAY, RECORD_STATUS, fmtDate, pct } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

export interface Exposure {
  id: string;
  url: string;
  title: string | null;
  domain: string;
  sourceId: string | null;
  sourceName: string | null;
  category: string;
  dataTypes: string[];
  isSearchResult: boolean;
  searchEngine: string | null;
  searchRank: number | null;
  matchConfidence: number;
  matchBand: string;
  matchExplanation: Array<{ factor: string; effect: string; detail: string }>;
  userConfirmed: boolean | null;
  status: string;
  statusReason: string | null;
  priorityScore: number;
  priorityLevel: string;
  priorityFactors: Array<{ factor: string; points: number; detail: string }>;
  parentRecordId: string | null;
  publicInterest: boolean;
  firstSeenAt: string;
  removedAt: string | null;
  removalOutcome: string | null;
}

type Tab = "all" | "review" | "clusters" | "search";
const PRIORITY_TONE = { HIGH: "red", MEDIUM: "amber", LOW: "gray" } as const;

function ExposuresInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? (params.get("status") === "NEEDS_REVIEW" ? "review" : "all"));
  const category = params.get("category");
  const status = params.get("status");
  const q = useMemo(() => {
    const s = new URLSearchParams({ limit: "200" });
    if (tab === "review") s.set("status", "NEEDS_REVIEW");
    else if (status) s.set("status", status);
    if (category) s.set("category", category);
    s.set("includeSearch", tab === "search" ? "true" : "false");
    return `/exposures?${s.toString()}`;
  }, [tab, category, status]);
  const list = useApi<{ items: Exposure[]; total: number }>(tab === "clusters" ? null : q);
  const clusters = useApi<{ clusters: Array<{ id: string; label: string; dataTypes: string[]; originRecordId: string | null; searchAppearances: Record<string, number>; mirrors: string[]; recommendedAction: string; memberIds: string[] }> }>(
    tab === "clusters" ? "/exposures/clusters" : null,
  );
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const items = (list.data?.items ?? []).filter((i) => (tab === "search" ? i.isSearchResult : true));

  return (
    <>
      <PageHeader title="Exposures" subtitle="Everywhere we found information that appears to be about you." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace("/exposures");
        }}
        tabs={[
          { id: "all", label: "Sources" },
          { id: "review", label: "Needs review" },
          { id: "clusters", label: "Exposure clusters" },
          { id: "search", label: "Search results" },
        ]}
      />
      {(category || status) && (
        <div className="row small" style={{ marginBottom: 12 }}>
          <span className="muted">Filtered by</span>
          {category && <Badge plain>{category.split(",").map((c) => CATEGORY[c] ?? c).join(", ")}</Badge>}
          {status && <Badge plain>{RECORD_STATUS[status]?.label ?? status}</Badge>}
          <button className="btn ghost sm" onClick={() => router.replace("/exposures")}>Clear</button>
        </div>
      )}

      {tab === "clusters" ? (
        !clusters.data ? (
          <Spinner />
        ) : clusters.data.clusters.length === 0 ? (
          <Card><Empty title="No clusters yet" /></Card>
        ) : (
          <div className="grid cols-2">
            {clusters.data.clusters.map((c, i) => (
              <Card key={c.id} title={`Exposure cluster #${i + 1}`}>
                <h3>{c.label}</h3>
                <div className="chips" style={{ marginBottom: 10 }}>
                  {c.dataTypes.map((t) => <span key={t} className="chip">{DATA_TYPE[t] ?? t}</span>)}
                </div>
                <dl className="kv">
                  <dt>Search appearances</dt>
                  <dd>{Object.entries(c.searchAppearances).map(([k, v]) => `${k} — ${v}`).join(", ") || "None found"}</dd>
                  <dt>Mirrors</dt>
                  <dd>{c.mirrors.join(", ") || "None"}</dd>
                  <dt>Recommended</dt>
                  <dd>{c.recommendedAction}</dd>
                </dl>
                {c.originRecordId && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setOpenId(c.originRecordId)}>Open original source</button>}
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card>
          <ErrorNote error={list.error} />
          {!list.data ? (
            <Spinner />
          ) : items.length === 0 ? (
            <Empty title={tab === "review" ? "Nothing to review" : "No exposures here"}>
              {tab === "review" ? "Possible matches that need your confirmation will appear here." : "Run a scan to discover where your information appears."}
            </Empty>
          ) : (
            <div className="list">
              {items.map((e) => (
                <div key={e.id} className="list-item clickable" onClick={() => setOpenId(e.id)} role="button" tabIndex={0} onKeyDown={(k) => k.key === "Enter" && setOpenId(e.id)}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{e.isSearchResult ? `${e.searchEngine ?? "Search"} result #${e.searchRank ?? "?"}` : e.sourceName ?? e.domain}</strong>
                      <span className="small faint">{CATEGORY[e.category] ?? e.category}</span>
                      {e.publicInterest && <Badge plain>Public interest</Badge>}
                    </div>
                    <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title ?? e.url}</div>
                    <div className="chips" style={{ marginTop: 6 }}>
                      {e.dataTypes.map((t) => <span key={t} className="chip">{DATA_TYPE[t] ?? t}</span>)}
                    </div>
                  </div>
                  <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
                    <StatusBadge map={RECORD_STATUS} status={e.status} />
                    <Badge tone={PRIORITY_TONE[e.priorityLevel as keyof typeof PRIORITY_TONE] ?? "gray"} plain>
                      {e.priorityLevel.toLowerCase()} priority
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      <ExposureDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.reload()} />
    </>
  );
}

interface Detail {
  exposure: Exposure;
  explanation: string;
  pathways: Array<{ pathway: string; confidence: string; why: string; caveat?: string }>;
  downstreamIds: string[];
  requests: Array<{ id: string; status: string; method: string }>;
  verificationChecks: Array<{ kind: string; outcome: string; method: string; checked_at: string }>;
}

function ExposureDrawer({ id, onClose, onChanged }: { id: string | null; onClose(): void; onChanged(): void }) {
  const { profile } = useSession();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      setD(await api<Detail>(withProfile(`/exposures/${id}`, profile?.id)));
    } catch (e) {
      setErr(e as Error);
    }
  }
  useEffect(() => {
    setD(null);
    setErr(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, body: unknown = {}) {
    setErr(null);
    try {
      const r = await api<{ requestId?: string; request?: { id: string } }>(withProfile(path, profile?.id), { body });
      await load();
      onChanged();
      const rid = r.requestId ?? r.request?.id;
      if (rid) setPreview(rid);
    } catch (e) {
      setErr(e as Error);
    }
  }

  const e = d?.exposure;
  const open = d?.requests.find((r) => !["COMPLETED", "FAILED", "CANCELLED"].includes(r.status));
  return (
    <>
      <Drawer open={!!id} onClose={onClose} label="Exposure details">
        {!e ? (
          err ? <ErrorNote error={err} /> : <Spinner />
        ) : (
          <div className="stack">
            <div className="row between">
              <StatusBadge map={RECORD_STATUS} status={e.status} />
              <button className="btn ghost sm" onClick={onClose}>Close</button>
            </div>
            <h2 style={{ marginBottom: 0 }}>{e.sourceName ?? e.domain}</h2>
            <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="mono small" style={{ wordBreak: "break-all" }}>{e.url}</a>
            <p className="muted small" style={{ margin: 0 }}>{d.explanation}</p>
            {e.statusReason && <div className="notice small">{e.statusReason}</div>}
            {e.removalOutcome && (
              <div className="notice ok small">
                <strong>{OUTCOME[e.removalOutcome]?.label}</strong> — {OUTCOME[e.removalOutcome]?.help}
              </div>
            )}

            <div className="card flat">
              <div className="card-title">Identity match</div>
              <div className="row">
                <StatusBadge map={BAND} status={e.matchBand} />
                <span className="mono">{pct(e.matchConfidence)}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                {e.matchExplanation.map((f, i) => (
                  <div key={i} className="factor">
                    <span>{f.detail}</span>
                    <span className={f.effect === "supports" ? "tone-green" : f.effect === "contradicts" ? "tone-red" : "muted"}>{f.effect === "supports" ? "+" : f.effect === "contradicts" ? "−" : "·"}</span>
                  </div>
                ))}
              </div>
              {e.userConfirmed === null && e.status !== "DISMISSED" && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn sm primary" onClick={() => void act(`/exposures/${e.id}/confirm`)}>Yes, this is me</button>
                  <button className="btn sm" onClick={() => void act(`/exposures/${e.id}/dismiss`)}>Not me</button>
                </div>
              )}
            </div>

            <div className="card flat">
              <div className="card-title">Why this priority ({e.priorityLevel.toLowerCase()})</div>
              {e.priorityFactors.map((f, i) => (
                <div key={i} className="factor">
                  <span>{f.detail}</span>
                  <span className="mono muted">{f.points > 0 ? "+" : ""}{f.points}</span>
                </div>
              ))}
            </div>

            <div className="card flat">
              <div className="card-title">Potential pathways</div>
              {d.pathways.length === 0 && <div className="muted small">No legitimate removal process is available for this result.</div>}
              {d.pathways.map((p) => (
                <div key={p.pathway} style={{ marginBottom: 10 }}>
                  <div className="row">
                    <strong className="small">{PATHWAY[p.pathway] ?? p.pathway}</strong>
                    <Badge tone={p.confidence === "HIGH" ? "green" : p.confidence === "MEDIUM" ? "amber" : "gray"} plain>{p.confidence.toLowerCase()}</Badge>
                  </div>
                  <div className="small muted">{p.why}</div>
                  {p.caveat && <div className="small faint">{p.caveat}</div>}
                </div>
              ))}
              <div className="small faint">Informational only — not legal advice.</div>
            </div>

            {d.verificationChecks.length > 0 && (
              <div className="card flat">
                <div className="card-title">Verification history</div>
                {d.verificationChecks.map((v, i) => (
                  <div key={i} className="row small" style={{ padding: "3px 0" }}>
                    <StatusBadge map={OUTCOME} status={v.outcome} />
                    <span className="muted">{v.kind.toLowerCase().replace("_", " ")} · {fmtDate(v.checked_at)}</span>
                  </div>
                ))}
              </div>
            )}

            <ErrorNote error={err} />
            <div className="row">
              {open ? (
                <button className="btn primary" onClick={() => setPreview(open.id)}>View removal request</button>
              ) : (
                !e.publicInterest &&
                e.status !== "DISMISSED" &&
                d.pathways.length > 0 && (
                  <button className="btn primary" onClick={() => void act("/removals", { recordId: e.id })}>
                    {e.status === "REAPPEARED" ? "Submit removal again" : "Request removal"}
                  </button>
                )
              )}
              {e.status !== "DISMISSED" && e.userConfirmed !== null && (
                <button className="btn ghost" onClick={() => void act(`/exposures/${e.id}/dismiss`)}>Mark as not me</button>
              )}
            </div>
            {e.publicInterest && (
              <div className="small faint">
                This looks like lawful public-interest content. We show it for awareness but don&apos;t recommend removal requests merely because
                content is unfavorable.
              </div>
            )}
          </div>
        )}
      </Drawer>
      <RequestPreview requestId={preview} onClose={() => setPreview(null)} onChanged={() => { void load(); onChanged(); }} />
    </>
  );
}

export default function ExposuresPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ExposuresInner />
    </Suspense>
  );
}
