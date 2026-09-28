import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeReliability, type Reliability } from "../../../core/reliability";
import type { RegistryLookup } from "../../../core/classification";
import { DataSourceSchema, type DataSource } from "../../../providers/registry/types";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "../../../removal-agents/engine/definition";
import type { SourceRuntime } from "../../../removal-agents/types";
import type { AppContext } from "../context";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REGISTRY_DIR = process.env.REGISTRY_DIR ?? path.resolve(here, "../../../providers/registry");

interface SourceRow {
  id: string;
  name: string;
  domain: string;
  categories: string[];
  discovery_methods: string[];
  removal_methods: string[];
  requires_user_verification: boolean;
  requires_email_verification: boolean;
  requires_identity_verification: boolean;
  estimated_removal_days: number;
  reappears_frequently: boolean;
  supported_regions: string[];
  automation_status: string;
  agent_key: string;
  opt_out_url: string | null;
  privacy_contact_email: string | null;
  parent_source_id: string | null;
  notes: string | null;
  enabled: boolean;
  automation_paused: boolean;
  automation_paused_reason: string | null;
  last_verified_at: Date | null;
}

export function toRuntime(r: SourceRow): SourceRuntime {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    categories: r.categories as DataSource["categories"],
    discoveryMethods: r.discovery_methods as DataSource["discoveryMethods"],
    removalMethods: r.removal_methods as DataSource["removalMethods"],
    requiresUserVerification: r.requires_user_verification,
    requiresEmailVerification: r.requires_email_verification,
    requiresIdentityVerification: r.requires_identity_verification,
    estimatedRemovalTime: r.estimated_removal_days,
    reappearsFrequently: r.reappears_frequently,
    supportedRegions: r.supported_regions,
    automationStatus: r.automation_status as DataSource["automationStatus"],
    agent: r.agent_key,
    optOutUrl: r.opt_out_url ?? undefined,
    privacyContactEmail: r.privacy_contact_email ?? undefined,
    parentSourceId: r.parent_source_id ?? undefined,
    notes: r.notes ?? undefined,
    lastVerifiedAt: r.last_verified_at?.toISOString(),
    enabled: r.enabled,
    automationPaused: r.automation_paused,
  };
}

/** Load and validate every registry JSON file. Throws on the first invalid entry. */
export async function loadRegistryFiles(dir = REGISTRY_DIR): Promise<{ sources: DataSource[]; workflows: WorkflowDefinition[] }> {
  const sources: DataSource[] = [];
  for (const f of (await readdir(path.join(dir, "sources"))).filter((x) => x.endsWith(".json")).sort()) {
    const parsed = DataSourceSchema.safeParse(JSON.parse(await readFile(path.join(dir, "sources", f), "utf8")));
    if (!parsed.success) throw new Error(`Invalid registry file ${f}: ${parsed.error.message}`);
    sources.push(parsed.data);
  }
  const workflows: WorkflowDefinition[] = [];
  for (const f of (await readdir(path.join(dir, "workflows"))).filter((x) => x.endsWith(".json")).sort()) {
    const parsed = WorkflowDefinitionSchema.safeParse(JSON.parse(await readFile(path.join(dir, "workflows", f), "utf8")));
    if (!parsed.success) throw new Error(`Invalid workflow file ${f}: ${parsed.error.message}`);
    workflows.push(parsed.data);
  }
  return { sources, workflows };
}

/**
 * Upsert registry files into the database. Operational state (enabled,
 * automation_paused) set by admins is preserved. Bundled workflows are
 * inserted as new versions and activated only if no version is active.
 */
export async function seedRegistry(ctx: AppContext, dir = REGISTRY_DIR): Promise<{ sources: number; workflows: number }> {
  const { sources, workflows } = await loadRegistryFiles(dir);
  // Parents first so the FK is satisfied.
  const ordered = [...sources.filter((s) => !s.parentSourceId), ...sources.filter((s) => s.parentSourceId)];
  for (const s of ordered) {
    await ctx.db.query(
      `INSERT INTO data_sources (id, name, domain, categories, discovery_methods, removal_methods, requires_user_verification,
         requires_email_verification, requires_identity_verification, estimated_removal_days, reappears_frequently,
         supported_regions, automation_status, agent_key, opt_out_url, privacy_contact_email, parent_source_id, notes, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, domain = EXCLUDED.domain, categories = EXCLUDED.categories,
         discovery_methods = EXCLUDED.discovery_methods, removal_methods = EXCLUDED.removal_methods,
         requires_user_verification = EXCLUDED.requires_user_verification, requires_email_verification = EXCLUDED.requires_email_verification,
         requires_identity_verification = EXCLUDED.requires_identity_verification, estimated_removal_days = EXCLUDED.estimated_removal_days,
         reappears_frequently = EXCLUDED.reappears_frequently, supported_regions = EXCLUDED.supported_regions,
         automation_status = EXCLUDED.automation_status, agent_key = EXCLUDED.agent_key, opt_out_url = EXCLUDED.opt_out_url,
         privacy_contact_email = EXCLUDED.privacy_contact_email, parent_source_id = EXCLUDED.parent_source_id, notes = EXCLUDED.notes,
         last_verified_at = COALESCE(EXCLUDED.last_verified_at, data_sources.last_verified_at), updated_at = now()`,
      [
        s.id, s.name, s.domain, s.categories, s.discoveryMethods, s.removalMethods, s.requiresUserVerification,
        s.requiresEmailVerification, s.requiresIdentityVerification, s.estimatedRemovalTime, s.reappearsFrequently,
        s.supportedRegions, s.automationStatus, s.agent, s.optOutUrl ?? null, s.privacyContactEmail ?? null,
        s.parentSourceId ?? null, s.notes ?? null, s.lastVerifiedAt ?? null,
      ],
    );
  }
  let wf = 0;
  for (const w of workflows) {
    const inserted = await ctx.db.one(
      `INSERT INTO provider_configs (source_id, version, status, definition, changelog)
       VALUES ($1, $2, 'DRAFT', $3, 'Bundled definition') ON CONFLICT (source_id, version) DO NOTHING RETURNING id`,
      [w.source, w.version, JSON.stringify(w)],
    );
    if (inserted) wf++;
    const active = await ctx.db.one("SELECT 1 FROM provider_configs WHERE source_id = $1 AND status = 'ACTIVE'", [w.source]);
    if (!active) {
      await ctx.db.query(
        "UPDATE provider_configs SET status = 'ACTIVE', activated_at = now() WHERE source_id = $1 AND version = $2",
        [w.source, w.version],
      );
    }
  }
  invalidateRegistryCache();
  return { sources: sources.length, workflows: wf };
}

let cache: { at: number; rows: SourceRuntime[] } | undefined;
const CACHE_MS = 30_000;

export function invalidateRegistryCache(): void {
  cache = undefined;
}

export async function allSources(ctx: AppContext): Promise<SourceRuntime[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = (await ctx.db.query<SourceRow>("SELECT * FROM data_sources ORDER BY name")).map(toRuntime);
  cache = { at: Date.now(), rows };
  return rows;
}

export async function getSource(ctx: AppContext, id: string): Promise<SourceRuntime | undefined> {
  return (await allSources(ctx)).find((s) => s.id === id);
}

export async function registryLookup(ctx: AppContext): Promise<RegistryLookup> {
  const enabled = (await allSources(ctx)).filter((s) => s.enabled);
  const byDomain = new Map(enabled.map((s) => [s.domain, s]));
  const byId = new Map(enabled.map((s) => [s.id, s]));
  return { byDomain: (d) => byDomain.get(d), byId: (id) => byId.get(id) };
}

export async function activeWorkflow(ctx: AppContext, sourceId: string): Promise<{ definition: WorkflowDefinition; configId: string } | undefined> {
  const row = await ctx.db.one<{ id: string; definition: WorkflowDefinition }>(
    "SELECT id, definition FROM provider_configs WHERE source_id = $1 AND status = 'ACTIVE'",
    [sourceId],
  );
  return row ? { definition: WorkflowDefinitionSchema.parse(row.definition), configId: row.id } : undefined;
}

/** Base URL an agent should use. The bundled example broker points at the local mock. */
export function baseUrlFor(ctx: AppContext, s: SourceRuntime): string {
  if (s.agent === "example-broker") return ctx.cfg.EXAMPLE_BROKER_BASE_URL.replace(/\/$/, "");
  return `https://${s.domain}`;
}

/** Historical reliability from the platform's own data (spec §26). */
export async function sourceReliability(ctx: AppContext, sourceId?: string): Promise<Map<string, Reliability>> {
  const rows = await ctx.db.query<{
    source_id: string;
    removed: number;
    failed: number;
    reappeared: number;
    completed: number;
    avg_days: number | null;
  }>(
    `SELECT r.source_id,
            count(*) FILTER (WHERE d.removed_at IS NOT NULL OR d.status IN ('REMOVED','REAPPEARED'))::int AS removed,
            count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed,
            count(*) FILTER (WHERE d.status = 'REAPPEARED')::int AS reappeared,
            count(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
            avg(EXTRACT(EPOCH FROM (d.removed_at - r.submitted_at)) / 86400) FILTER (WHERE d.removed_at IS NOT NULL AND r.submitted_at IS NOT NULL) AS avg_days
     FROM removal_requests r JOIN discovered_records d ON d.id = r.record_id
     WHERE r.source_id IS NOT NULL AND ($1::text IS NULL OR r.source_id = $1)
     GROUP BY r.source_id`,
    [sourceId ?? null],
  );
  return new Map(
    rows.map((r) => [
      r.source_id,
      computeReliability({ completed: r.completed, removed: r.removed, failed: r.failed, reappeared: r.reappeared, avgRemovalDays: r.avg_days }),
    ]),
  );
}
