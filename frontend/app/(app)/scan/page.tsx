"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, withProfile } from "@/lib/api";
import { TOPICS, fmtDate, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";

interface Scan {
  id: string;
  trigger: string;
  status: string;
  stats: { searchProviders?: string[]; providerErrors?: number; queries?: number; retained?: number; newRecords?: number; reappeared?: number; discardedLowConfidence?: number; siteSearches?: number; score?: number };
  focus?: { topics: string[]; customTerms: string[] };
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
  const [topics, setTopics] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const running = scans.data?.scans.find((s) => s.status === "QUEUED" || s.status === "RUNNING");
  const last = scans.data?.scans.find((s) => s.status === "COMPLETED");
  const engines = last?.stats.searchProviders;
  const demoOnly = !!engines && engines.filter((e) => e !== "fixture").length === 0;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const customTerms = custom.split(",").map((t) => t.trim()).filter(Boolean);
      await api(withProfile("/scans", profile?.id), { body: { topics, customTerms } });
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
        <div style={{ marginTop: 16 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Also look for these topics (optional)</div>
          <div className="row" style={{ gap: 16 }}>
            {TOPICS.map((t) => (
              <label key={t.id} className="check">
                <input
                  type="checkbox"
                  checked={topics.includes(t.id)}
                  onChange={(e) => setTopics((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10, maxWidth: 480 }}>
            Your own search words (up to 3, separated by commas)
            <input className="input" placeholder="e.g. DUI, lawsuit" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </label>
          <div className="small faint" style={{ marginTop: 6 }}>
            Topics are always searched together with the profile&apos;s name. News coverage is shown for awareness; set the case outcome in Settings to
            unlock options like asking a publisher to update a story.
          </div>
        </div>
        {running && (
          <div style={{ marginTop: 16 }}>
            <div className="bar"><span style={{ width: running.status === "RUNNING" ? "60%" : "15%" }} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>Discover → match → classify → prioritize. You can leave this page; we&apos;ll notify you.</div>
          </div>
        )}
        <ErrorNote error={error} />
      </Card>

      {demoOnly && (
        <div className="notice warn" style={{ margin: "16px 0" }}>
          <strong>Web search is not connected.</strong> The last scan only used{" "}
          {engines!.length ? "built-in demo data" : "known data-broker sites"}, not the real internet. To search the web, add a search API key
          (for example <span className="mono">SERPAPI_API_KEY</span>) and set <span className="mono">SEARCH_PROVIDERS=serpapi</span> in the
          <span className="mono"> .env</span> file, then restart the app.
        </div>
      )}
      {!!last && !demoOnly && (last.stats.retained ?? 0) === 0 && (last.stats.discardedLowConfidence ?? 0) > 0 && (
        <div className="notice warn" style={{ margin: "16px 0" }}>
          <strong>Search worked, but nothing matched strongly enough.</strong> We found {last.stats.discardedLowConfidence} result(s),
          but none mentioned anything besides the name, so we couldn&apos;t tell them apart from other people with the same name.
          Add a <strong>city and state</strong> (and any usernames, emails or phone numbers) in{" "}
          <Link href="/settings">Settings → My identities</Link>, then scan again.
        </div>
      )}
      {!!last?.stats.providerErrors && !demoOnly && (
        <div className="notice err" style={{ margin: "16px 0" }}>
          {last.stats.providerErrors} search request(s) failed in the last scan. Check that your search API key is correct and has quota left.
        </div>
      )}
      <Card title="Scan history" className="fade-in" >
        {!scans.data ? (
          <Spinner />
        ) : scans.data.scans.length === 0 ? (
          <Empty title="No scans yet" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Topics</th><th>Status</th><th>Found</th><th>New</th><th>Discarded (not you)</th></tr>
            </thead>
            <tbody>
              {scans.data.scans.map((s) => (
                <tr key={s.id}>
                  <td title={fmtDate(s.created_at)}>{fmtRelative(s.created_at)}</td>
                  <td className="muted">{s.trigger.toLowerCase()}</td>
                  <td className="small muted">
                    {[...(s.focus?.topics ?? []).map((t) => TOPICS.find((x) => x.id === t)?.label ?? t), ...(s.focus?.customTerms ?? [])].join(", ") || "—"}
                  </td>
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
