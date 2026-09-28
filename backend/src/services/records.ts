import type { PoolClient } from "pg";
import { clusterFingerprint, summarizeCluster, type ClusterMember } from "../../../core/clustering";
import type { CandidateAttributes } from "../../../core/extract";
import { bandFor, MATCH_THRESHOLDS } from "../../../core/matching";
import { canonicalUrl, domainOf } from "../../../core/normalize";
import { prioritize } from "../../../core/prioritization";
import type { SubjectProfile } from "../../../core/subject";
import type { DiscoveryHit } from "../../../providers/discovery/engine";
import type { AgentRecord } from "../../../removal-agents/types";
import type { DataType, ExposureCategory, PriorityLevel, RecordStatus } from "../../../shared/domain";
import { notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { allSources, sourceReliability } from "./sources";

export const recordAad = (profileId: string) => `record:${profileId}`;

/** Search engines that have a registry entry for their official removal process. */
export const ENGINE_SOURCE: Record<string, string> = { google: "google-search", bing: "bing-search" };

export interface RecordRow {
  id: string;
  profile_id: string;
  scan_id: string | null;
  source_id: string | null;
  url_ciphertext: string;
  url_hash: string;
  domain: string;
  title_ciphertext: string | null;
  snippet_ciphertext: string | null;
  attributes_ciphertext: string | null;
  data_types: DataType[];
  category: ExposureCategory;
  discovery_method: string;
  is_search_result: boolean;
  search_engine: string | null;
  search_rank: number | null;
  match_confidence: number;
  match_band: string;
  match_explanation: unknown;
  user_confirmed: boolean | null;
  status: RecordStatus;
  status_reason: string | null;
  priority_score: number;
  priority_level: PriorityLevel;
  priority_factors: unknown;
  cluster_id: string | null;
  parent_record_id: string | null;
  public_interest_flag: boolean;
  first_seen_at: Date;
  last_seen_at: Date;
  removed_at: Date | null;
  removal_outcome: string | null;
  created_at: Date;
  updated_at: Date;
}

export function decryptUrl(ctx: AppContext, r: Pick<RecordRow, "profile_id" | "url_ciphertext">): string {
  return ctx.cipher.decrypt(r.url_ciphertext, recordAad(r.profile_id));
}

export function toAgentRecord(ctx: AppContext, r: RecordRow, extra: { parentUrl?: string | null; originGone?: boolean } = {}): AgentRecord {
  return {
    id: r.id,
    url: decryptUrl(ctx, r),
    sourceId: r.source_id,
    category: r.category,
    dataTypes: r.data_types,
    isSearchResult: r.is_search_result,
    searchEngine: r.search_engine,
    ...extra,
  };
}

export interface PersistSummary {
  newRecordIds: string[];
  reappearedRecordIds: string[];
  updatedRecordIds: string[];
}

/**
 * Store discovery hits: one "page" record per URL plus one child record per
 * search-engine appearance, grouped into exposure clusters. Existing records
 * are refreshed; previously removed ones that are live again become REAPPEARED.
 */
export async function persistDiscovery(
  ctx: AppContext,
  profileId: string,
  scanId: string,
  subject: SubjectProfile,
  hits: DiscoveryHit[],
): Promise<PersistSummary> {
  const sources = new Map((await allSources(ctx)).map((s) => [s.id, s]));
  const reliability = await sourceReliability(ctx);
  const summary: PersistSummary = { newRecordIds: [], reappearedRecordIds: [], updatedRecordIds: [] };
  const aad = recordAad(profileId);

  await ctx.db.tx(async (c) => {
    for (const hit of hits) {
      const src = hit.sourceId ? sources.get(hit.sourceId) : undefined;
      const family = src?.parentSourceId ?? src?.id ?? domainOf(hit.url);
      // Mirrors of a parent source depend on the parent's record (dependency graph) when
      // they republish the same underlying data (shared phone/email, or name + address).
      let parentId: string | null = null;
      let cluster: { id: string; origin_record_id: string | null } | undefined;
      if (src?.parentSourceId) {
        const origins = await c.query<{ id: string; cluster_id: string | null; attributes_ciphertext: string | null }>(
          "SELECT id, cluster_id, attributes_ciphertext FROM discovered_records WHERE profile_id = $1 AND source_id = $2 AND NOT is_search_result",
          [profileId, src.parentSourceId],
        );
        for (const o of origins.rows) {
          if (!o.attributes_ciphertext || !o.cluster_id) continue;
          const oa = ctx.cipher.decryptJson<CandidateAttributes>(o.attributes_ciphertext, aad);
          if (sameUnderlyingRecord(subject, oa, hit.attributes)) {
            parentId = o.id;
            cluster = { id: o.cluster_id, origin_record_id: o.id };
            break;
          }
        }
      }
      cluster ??= await upsertCluster(
        c,
        profileId,
        clusterFingerprint({ sourceFamily: family, subject, attributes: hit.attributes }),
        src?.name ?? domainOf(hit.url),
      );

      const bestRank = hit.searchAppearances.reduce<number | null>((m, a) => (m === null ? a.rank : Math.min(m, a.rank)), null);
      const rel = src ? reliability.get(src.id) : undefined;
      const pri = prioritize({
        dataTypes: hit.dataTypes,
        confidence: hit.match.confidence,
        category: hit.classification.category,
        isSearchResult: false,
        hasOrigin: !!parentId,
        searchAppearances: hit.searchAppearances.length,
        bestSearchRank: bestRank,
        automationStatus: src?.automationStatus,
        historicalSuccessRate: rel?.sufficientData ? rel.successRate : null,
        reappearsFrequently: src?.reappearsFrequently,
        publicInterest: hit.classification.publicInterest,
      });

      const page = await upsertRecord(c, ctx, {
        profileId,
        scanId,
        urlHash: ctx.cipher.blindIndex(hit.canonical, "record-url"),
        urlCiphertext: ctx.cipher.encrypt(hit.url, aad),
        domain: domainOf(hit.url),
        titleCiphertext: hit.title ? ctx.cipher.encrypt(hit.title, aad) : null,
        snippetCiphertext: ctx.cipher.encrypt(hit.snippet, aad),
        attributesCiphertext: ctx.cipher.encryptJson(hit.attributes, aad),
        dataTypes: hit.dataTypes,
        category: hit.classification.category,
        discoveryMethod: hit.discoveryMethod,
        isSearchResult: false,
        searchEngine: null,
        searchRank: null,
        sourceId: src?.id ?? null,
        confidence: hit.match.confidence,
        explanation: hit.match.factors,
        priority: pri,
        clusterId: cluster.id,
        parentId,
        publicInterest: hit.classification.publicInterest,
        statusReason: hit.classification.reason,
      });
      track(summary, page);
      if (!cluster.origin_record_id || src?.id === family) {
        await c.query("UPDATE exposure_clusters SET origin_record_id = COALESCE(origin_record_id, $2) WHERE id = $1", [cluster.id, page.id]);
      }

      for (const a of hit.searchAppearances) {
        const childPri = prioritize({
          dataTypes: hit.dataTypes,
          confidence: hit.match.confidence,
          category: "SEARCH_RESULT",
          isSearchResult: true,
          hasOrigin: true,
          searchAppearances: 1,
          bestSearchRank: a.rank,
          publicInterest: hit.classification.publicInterest,
        });
        const child = await upsertRecord(c, ctx, {
          profileId,
          scanId,
          urlHash: ctx.cipher.blindIndex(`${a.engine}|${hit.canonical}`, "record-url"),
          urlCiphertext: ctx.cipher.encrypt(hit.url, aad),
          domain: domainOf(hit.url),
          titleCiphertext: hit.title ? ctx.cipher.encrypt(hit.title, aad) : null,
          snippetCiphertext: null,
          attributesCiphertext: null,
          dataTypes: hit.dataTypes,
          category: "SEARCH_RESULT",
          discoveryMethod: "SEARCH_API",
          isSearchResult: true,
          searchEngine: a.engine,
          searchRank: a.rank,
          sourceId: ENGINE_SOURCE[a.engine] ?? null,
          confidence: hit.match.confidence,
          explanation: hit.match.factors,
          priority: childPri,
          clusterId: cluster.id,
          parentId: page.id,
          publicInterest: hit.classification.publicInterest,
          statusReason: `${a.engineName} result #${a.rank}`,
        });
        track(summary, child);
      }
    }
  });
  return summary;
}

function sameUnderlyingRecord(subject: SubjectProfile, a: CandidateAttributes, b: CandidateAttributes): boolean {
  const shared = (x: string[], y: string[], mine: string[]) => x.some((v) => mine.includes(v) && y.includes(v));
  if (shared(a.phones, b.phones, subject.phones) || shared(a.emails, b.emails, subject.emails)) return true;
  return a.hasStreetAddress && b.hasStreetAddress && a.names.some((n) => b.names.includes(n));
}

function track(s: PersistSummary, r: { id: string; isNew: boolean; reappeared: boolean }) {
  if (r.isNew) s.newRecordIds.push(r.id);
  else if (r.reappeared) s.reappearedRecordIds.push(r.id);
  else s.updatedRecordIds.push(r.id);
}

async function upsertCluster(c: PoolClient, profileId: string, fingerprint: string, label: string) {
  const res = await c.query<{ id: string; origin_record_id: string | null }>(
    `INSERT INTO exposure_clusters (profile_id, fingerprint, label) VALUES ($1, $2, $3)
     ON CONFLICT (profile_id, fingerprint) DO UPDATE SET label = exposure_clusters.label
     RETURNING id, origin_record_id`,
    [profileId, fingerprint, label],
  );
  return res.rows[0]!;
}

interface UpsertInput {
  profileId: string;
  scanId: string;
  urlHash: string;
  urlCiphertext: string;
  domain: string;
  titleCiphertext: string | null;
  snippetCiphertext: string | null;
  attributesCiphertext: string | null;
  dataTypes: DataType[];
  category: ExposureCategory;
  discoveryMethod: string;
  isSearchResult: boolean;
  searchEngine: string | null;
  searchRank: number | null;
  sourceId: string | null;
  confidence: number;
  explanation: unknown;
  priority: { score: number; level: PriorityLevel; factors: unknown };
  clusterId: string;
  parentId: string | null;
  publicInterest: boolean;
  statusReason: string;
}

async function upsertRecord(c: PoolClient, ctx: AppContext, i: UpsertInput): Promise<{ id: string; isNew: boolean; reappeared: boolean }> {
  const existing = await c.query<{ id: string; status: RecordStatus; user_confirmed: boolean | null }>(
    "SELECT id, status, user_confirmed FROM discovered_records WHERE profile_id = $1 AND url_hash = $2 FOR UPDATE",
    [i.profileId, i.urlHash],
  );
  const now = ctx.clock.now();
  const prev = existing.rows[0];
  if (prev) {
    const reappeared = prev.status === "REMOVED";
    await c.query(
      `UPDATE discovered_records SET scan_id = $2, last_seen_at = $3, data_types = $4, match_confidence = GREATEST(match_confidence, $5),
         match_band = $6, match_explanation = $7, priority_score = $8, priority_level = $9, priority_factors = $10,
         search_rank = COALESCE($11, search_rank), snippet_ciphertext = COALESCE($12, snippet_ciphertext),
         attributes_ciphertext = COALESCE($13, attributes_ciphertext),
         status = CASE WHEN $14 THEN 'REAPPEARED' ELSE status END,
         status_reason = CASE WHEN $14 THEN 'Detected again after removal; the source may have regenerated the record.' ELSE status_reason END,
         removed_at = CASE WHEN $14 THEN NULL ELSE removed_at END,
         updated_at = now()
       WHERE id = $1`,
      [
        prev.id, i.scanId, now, i.dataTypes, i.confidence, bandFor(i.confidence), JSON.stringify(i.explanation),
        i.priority.score, i.priority.level, JSON.stringify(i.priority.factors), i.searchRank, i.snippetCiphertext,
        i.attributesCiphertext, reappeared,
      ],
    );
    return { id: prev.id, isNew: false, reappeared };
  }
  const status: RecordStatus = i.publicInterest
    ? "NO_ACTION_AVAILABLE"
    : i.confidence >= MATCH_THRESHOLDS.STRONG || i.category === "USER_CONTROLLED"
      ? "DISCOVERED"
      : "NEEDS_REVIEW";
  const res = await c.query<{ id: string }>(
    `INSERT INTO discovered_records (profile_id, scan_id, source_id, url_ciphertext, url_hash, domain, title_ciphertext,
       snippet_ciphertext, attributes_ciphertext, data_types, category, discovery_method, is_search_result, search_engine,
       search_rank, match_confidence, match_band, match_explanation, status, status_reason, priority_score, priority_level,
       priority_factors, cluster_id, parent_record_id, public_interest_flag, first_seen_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27)
     RETURNING id`,
    [
      i.profileId, i.scanId, i.sourceId, i.urlCiphertext, i.urlHash, i.domain, i.titleCiphertext, i.snippetCiphertext,
      i.attributesCiphertext, i.dataTypes, i.category, i.discoveryMethod, i.isSearchResult, i.searchEngine, i.searchRank,
      i.confidence, bandFor(i.confidence), JSON.stringify(i.explanation), status,
      status === "NO_ACTION_AVAILABLE" ? i.statusReason : i.statusReason, i.priority.score, i.priority.level,
      JSON.stringify(i.priority.factors), i.clusterId, i.parentId, i.publicInterest, now,
    ],
  );
  return { id: res.rows[0]!.id, isNew: true, reappeared: false };
}

// ---- Reads for the owner --------------------------------------------------

export interface ExposureView {
  id: string;
  url: string;
  title: string | null;
  domain: string;
  sourceId: string | null;
  sourceName: string | null;
  category: ExposureCategory;
  dataTypes: DataType[];
  isSearchResult: boolean;
  searchEngine: string | null;
  searchRank: number | null;
  matchConfidence: number;
  matchBand: string;
  matchExplanation: unknown;
  userConfirmed: boolean | null;
  status: RecordStatus;
  statusReason: string | null;
  priorityScore: number;
  priorityLevel: PriorityLevel;
  priorityFactors: unknown;
  clusterId: string | null;
  parentRecordId: string | null;
  publicInterest: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
  removalOutcome: string | null;
}

export async function toView(ctx: AppContext, r: RecordRow): Promise<ExposureView> {
  const aad = recordAad(r.profile_id);
  const src = r.source_id ? (await allSources(ctx)).find((s) => s.id === r.source_id) : undefined;
  return {
    id: r.id,
    url: ctx.cipher.decrypt(r.url_ciphertext, aad),
    title: r.title_ciphertext ? ctx.cipher.decrypt(r.title_ciphertext, aad) : null,
    domain: r.domain,
    sourceId: r.source_id,
    sourceName: src?.name ?? null,
    category: r.category,
    dataTypes: r.data_types,
    isSearchResult: r.is_search_result,
    searchEngine: r.search_engine,
    searchRank: r.search_rank,
    matchConfidence: r.match_confidence,
    matchBand: r.match_band,
    matchExplanation: r.match_explanation,
    userConfirmed: r.user_confirmed,
    status: r.status,
    statusReason: r.status_reason,
    priorityScore: r.priority_score,
    priorityLevel: r.priority_level,
    priorityFactors: r.priority_factors,
    clusterId: r.cluster_id,
    parentRecordId: r.parent_record_id,
    publicInterest: r.public_interest_flag,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at,
    removalOutcome: r.removal_outcome,
  };
}

export async function listExposures(
  ctx: AppContext,
  profileId: string,
  filter: { status?: string; category?: string; priority?: string; includeSearch?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: ExposureView[]; total: number }> {
  const where = ["profile_id = $1"];
  const params: unknown[] = [profileId];
  if (filter.status) {
    params.push(filter.status.split(","));
    where.push(`status = ANY($${params.length})`);
  }
  if (filter.category) {
    params.push(filter.category.split(","));
    where.push(`category = ANY($${params.length})`);
  }
  if (filter.priority) {
    params.push(filter.priority);
    where.push(`priority_level = $${params.length}`);
  }
  if (filter.includeSearch === false) where.push("NOT is_search_result");
  const total = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM discovered_records WHERE ${where.join(" AND ")}`, params);
  params.push(Math.min(200, filter.limit ?? 50), filter.offset ?? 0);
  const rows = await ctx.db.query<RecordRow>(
    `SELECT * FROM discovered_records WHERE ${where.join(" AND ")}
     ORDER BY (status = 'REAPPEARED') DESC, priority_score DESC, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: await Promise.all(rows.map((r) => toView(ctx, r))), total: total?.n ?? 0 };
}

export async function getOwnedRecord(ctx: AppContext, profileId: string, recordId: string): Promise<RecordRow> {
  const r = await ctx.db.one<RecordRow>("SELECT * FROM discovered_records WHERE id = $1 AND profile_id = $2", [recordId, profileId]);
  if (!r) throw notFound("Exposure");
  return r;
}

export async function getRecord(ctx: AppContext, recordId: string): Promise<RecordRow> {
  const r = await ctx.db.one<RecordRow>("SELECT * FROM discovered_records WHERE id = $1", [recordId]);
  if (!r) throw notFound("Exposure");
  return r;
}

export async function recordAttributes(ctx: AppContext, r: RecordRow): Promise<CandidateAttributes | null> {
  return r.attributes_ciphertext ? ctx.cipher.decryptJson<CandidateAttributes>(r.attributes_ciphertext, recordAad(r.profile_id)) : null;
}

export async function setRecordStatus(ctx: AppContext, recordId: string, status: RecordStatus, reason?: string | null, extra: { removedAt?: Date | null; outcome?: string | null } = {}) {
  await ctx.db.query(
    `UPDATE discovered_records SET status = $2, status_reason = COALESCE($3, status_reason),
       removed_at = CASE WHEN $4::boolean THEN $5 ELSE removed_at END,
       removal_outcome = COALESCE($6, removal_outcome), updated_at = now()
     WHERE id = $1`,
    [recordId, status, reason ?? null, extra.removedAt !== undefined, extra.removedAt ?? null, extra.outcome ?? null],
  );
}

export interface ClusterView {
  id: string;
  label: string;
  dataTypes: DataType[];
  originRecordId: string | null;
  searchAppearances: Record<string, number>;
  mirrors: string[];
  recommendedAction: string;
  memberIds: string[];
}

export async function listClusters(ctx: AppContext, profileId: string): Promise<ClusterView[]> {
  const clusters = await ctx.db.query<{ id: string; label: string }>("SELECT id, label FROM exposure_clusters WHERE profile_id = $1", [profileId]);
  const records = await ctx.db.query<RecordRow>("SELECT * FROM discovered_records WHERE profile_id = $1 AND cluster_id IS NOT NULL AND status <> 'DISMISSED'", [profileId]);
  const names = new Map((await allSources(ctx)).map((s) => [s.id, s.name]));
  const engineNames: Record<string, string> = { google: "Google", bing: "Bing", brave: "Brave Search", fixture: "Fixture Search" };
  return clusters
    .map((cl) => {
      const members = records.filter((r) => r.cluster_id === cl.id);
      if (!members.length) return null;
      const cm: ClusterMember[] = members.map((m) => ({
        id: m.id,
        sourceId: m.source_id,
        isSearchResult: m.is_search_result,
        parentRecordId: m.parent_record_id,
        searchEngine: m.search_engine ? engineNames[m.search_engine] ?? m.search_engine : null,
      }));
      const s = summarizeCluster(cm, names);
      return {
        id: cl.id,
        label: cl.label,
        dataTypes: [...new Set(members.flatMap((m) => m.data_types))],
        ...s,
        mirrors: s.mirrors.map((id) => names.get(id) ?? id),
        memberIds: members.map((m) => m.id),
      };
    })
    .filter((x): x is ClusterView => x !== null);
}

/** Exposure map (spec §16): counts per category group, active records only. */
export async function exposureMap(ctx: AppContext, profileId: string) {
  const rows = await ctx.db.query<{ category: string; sources: number; records: number }>(
    `SELECT category, count(DISTINCT COALESCE(source_id, domain))::int AS sources, count(*)::int AS records
     FROM discovered_records
     WHERE profile_id = $1 AND NOT is_search_result AND status NOT IN ('DISMISSED','REMOVED')
     GROUP BY category`,
    [profileId],
  );
  const search = await ctx.db.one<{ engines: number; records: number }>(
    `SELECT count(DISTINCT search_engine)::int AS engines, count(*)::int AS records FROM discovered_records
     WHERE profile_id = $1 AND is_search_result AND status NOT IN ('DISMISSED','REMOVED')`,
    [profileId],
  );
  const groups: Record<string, { label: string; categories: string[] }> = {
    brokers: { label: "Data brokers", categories: ["DATA_BROKER", "PEOPLE_SEARCH"] },
    social: { label: "Social sites", categories: ["SOCIAL", "PROFESSIONAL"] },
    directories: { label: "Directories", categories: ["DIRECTORY", "BUSINESS"] },
    own: { label: "Your sites", categories: ["USER_CONTROLLED"] },
    other: { label: "Other sites", categories: ["OTHER", "NEWS_OR_PUBLIC_INTEREST"] },
  };
  return {
    nodes: Object.entries(groups).map(([key, g]) => {
      const matching = rows.filter((r) => g.categories.includes(r.category));
      return {
        key,
        label: g.label,
        categories: g.categories,
        sources: matching.reduce((s, r) => s + r.sources, 0),
        records: matching.reduce((s, r) => s + r.records, 0),
      };
    }),
    search: { key: "search", label: "Search engines", engines: search?.engines ?? 0, records: search?.records ?? 0 },
  };
}

export function recordCanonical(url: string): string {
  return canonicalUrl(url);
}
