import PDFDocument from "pdfkit";
import type { AppContext } from "../context";
import { currentScore } from "./scoring";

/** Privacy report (spec §36). Aggregates only; listing URLs are excluded from exports by default. */
export async function reportSummary(ctx: AppContext, profileId: string) {
  const c = await ctx.db.one<Record<string, number>>(
    `SELECT count(*)::int AS initial,
       count(*) FILTER (WHERE status = 'REMOVED')::int AS removed,
       count(*) FILTER (WHERE status IN ('READY','AWAITING_APPROVAL','SUBMITTED','AWAITING_VERIFICATION','REQUIRES_USER_ACTION','PARTIALLY_REMOVED','DISCOVERED','NEEDS_REVIEW'))::int AS pending,
       count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE status = 'NO_ACTION_AVAILABLE')::int AS no_action,
       count(*) FILTER (WHERE status = 'REAPPEARED')::int AS reappeared,
       count(*) FILTER (WHERE status = 'DISMISSED')::int AS dismissed,
       count(*) FILTER (WHERE removal_outcome = 'REMOVED_FROM_SOURCE')::int AS removed_from_source,
       count(*) FILTER (WHERE removal_outcome = 'REMOVED_FROM_SEARCH_RESULTS')::int AS removed_from_search,
       count(*) FILTER (WHERE removal_outcome = 'NO_LONGER_DETECTED')::int AS no_longer_detected
     FROM discovered_records WHERE profile_id = $1 AND NOT is_search_result`,
    [profileId],
  );
  const bySource = await ctx.db.query<{ source: string; total: number; removed: number }>(
    `SELECT COALESCE(s.name, d.domain) AS source, count(*)::int AS total, count(*) FILTER (WHERE d.status = 'REMOVED')::int AS removed
     FROM discovered_records d LEFT JOIN data_sources s ON s.id = d.source_id
     WHERE d.profile_id = $1 AND NOT d.is_search_result AND d.status <> 'DISMISSED' GROUP BY 1 ORDER BY 2 DESC`,
    [profileId],
  );
  const score = await currentScore(ctx, profileId);
  const counts = c ?? {};
  return {
    generatedAt: ctx.clock.now().toISOString(),
    initialExposures: (counts.initial ?? 0) - (counts.dismissed ?? 0),
    removed: counts.removed ?? 0,
    pending: counts.pending ?? 0,
    failed: counts.failed ?? 0,
    noActionAvailable: counts.no_action ?? 0,
    reappeared: counts.reappeared ?? 0,
    currentExposure: (counts.pending ?? 0) + (counts.failed ?? 0) + (counts.no_action ?? 0) + (counts.reappeared ?? 0),
    outcomes: {
      removedFromSource: counts.removed_from_source ?? 0,
      removedFromSearchResults: counts.removed_from_search ?? 0,
      noLongerDetected: counts.no_longer_detected ?? 0,
    },
    privacyScore: score.score,
    bySource,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function reportCsv(ctx: AppContext, profileId: string): Promise<string> {
  const rows = await ctx.db.query<Record<string, unknown>>(
    `SELECT COALESCE(s.name, d.domain) AS source, d.category, d.is_search_result, d.search_engine, d.status, d.removal_outcome,
            d.priority_level, d.match_confidence, array_to_string(d.data_types, ';') AS data_types, d.first_seen_at, d.removed_at
     FROM discovered_records d LEFT JOIN data_sources s ON s.id = d.source_id
     WHERE d.profile_id = $1 AND d.status <> 'DISMISSED' ORDER BY d.first_seen_at`,
    [profileId],
  );
  const cols = ["source", "category", "is_search_result", "search_engine", "status", "removal_outcome", "priority_level", "match_confidence", "data_types", "first_seen_at", "removed_at"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c] instanceof Date ? (r[c] as Date).toISOString() : r[c])).join(","))].join("\n");
}

export async function reportPdf(ctx: AppContext, profileId: string): Promise<Buffer> {
  const s = await reportSummary(ctx, profileId);
  const doc = new PDFDocument({ size: "LETTER", margin: 56, info: { Title: "Privacy Report", Producer: "Deep Scrubber" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.fontSize(22).text("Privacy Report");
  doc.moveDown(0.3).fontSize(10).fillColor("#555").text(`Generated: ${new Date(s.generatedAt).toUTCString()}`);
  doc.moveDown().fillColor("#000").fontSize(12);
  const line = (k: string, v: number | string) => doc.text(`${k}: ${v}`);
  line("Privacy score", `${s.privacyScore} / 100`);
  line("Initial exposures", s.initialExposures);
  line("Removed", s.removed);
  line("  — removed from source", s.outcomes.removedFromSource);
  line("  — removed from search results", s.outcomes.removedFromSearchResults);
  line("  — no longer detected", s.outcomes.noLongerDetected);
  line("Pending", s.pending);
  line("Failed", s.failed);
  line("Reappeared", s.reappeared);
  line("No action available", s.noActionAvailable);
  line("Current exposure", `${s.currentExposure} results`);
  doc.moveDown().fontSize(14).text("By source");
  doc.fontSize(11);
  for (const b of s.bySource.slice(0, 40)) doc.text(`${b.source}: ${b.removed}/${b.total} removed`);
  doc.moveDown().fontSize(8).fillColor("#666").text(
    "“Removed from source” means the page is gone from the website. “Removed from search results” means a search engine no longer lists it. " +
      "“No longer detected” means the page loads but your information was not found on it. Removal from the internet is never guaranteed.",
  );
  doc.end();
  return done;
}
