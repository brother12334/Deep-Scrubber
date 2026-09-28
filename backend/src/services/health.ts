import { evaluateHealth } from "../../../core/reliability";
import type { AppContext } from "../context";
import { audit } from "./audit";
import { invalidateRegistryCache } from "./sources";

/**
 * Provider health monitoring (spec §28): a circuit breaker over the recent
 * window of automated runs. When the failure rate crosses the threshold,
 * automation for that provider pauses and admins are alerted, so the system
 * cannot keep submitting malformed requests.
 */
export async function evaluateProviderHealth(ctx: AppContext) {
  const window = await ctx.db.query<{ source_id: string; succeeded: number; failed: number }>(
    `SELECT source_id,
            count(*) FILTER (WHERE kind = 'RUN_SUCCEEDED')::int AS succeeded,
            count(*) FILTER (WHERE kind = 'RUN_FAILED')::int AS failed
     FROM (SELECT source_id, kind, row_number() OVER (PARTITION BY source_id ORDER BY created_at DESC) AS rn
           FROM provider_health_events WHERE kind IN ('RUN_SUCCEEDED','RUN_FAILED') AND created_at > now() - interval '7 days') t
     WHERE rn <= 50 GROUP BY source_id`,
  );
  const paused: string[] = [];
  const report = [];
  for (const w of window) {
    const d = evaluateHealth(w, ctx.cfg.PROVIDER_FAILURE_THRESHOLD, ctx.cfg.PROVIDER_MIN_SAMPLES);
    report.push({ sourceId: w.source_id, ...d });
    if (!d.shouldPause) continue;
    const row = await ctx.db.one<{ id: string; name: string }>(
      `UPDATE data_sources SET automation_paused = true, automation_paused_reason = $2, updated_at = now()
       WHERE id = $1 AND NOT automation_paused RETURNING id, name`,
      [w.source_id, `Failure rate ${(d.failureRate * 100).toFixed(0)}% over ${d.samples} runs`],
    );
    if (row) {
      paused.push(row.id);
      await ctx.db.query("INSERT INTO provider_health_events (source_id, kind, detail) VALUES ($1, 'AUTO_PAUSED', $2)", [row.id, `failure_rate=${d.failureRate}`]);
      await audit(ctx, { actorType: "system", action: "provider.auto_paused", targetType: "data_source", targetId: row.id, metadata: { failureRate: d.failureRate, samples: d.samples } });
      const admins = await ctx.db.query<{ id: string }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
      for (const a of admins) {
        await ctx.db.query(
          "INSERT INTO notifications (user_id, kind, severity, title, body, link) VALUES ($1, 'PROVIDER_WARNING', 'critical', $2, $3, $4)",
          [a.id, `PROVIDER WARNING — ${row.name}`, `${row.name} workflow failing. Failure rate: ${(d.failureRate * 100).toFixed(0)}%. Automation automatically paused. Manual review required.`, `/providers/${row.id}`],
        );
      }
    }
  }
  if (paused.length) invalidateRegistryCache();
  return { paused, report };
}

export async function setProviderPaused(ctx: AppContext, adminId: string, sourceId: string, paused: boolean, reason?: string) {
  await ctx.db.query(
    "UPDATE data_sources SET automation_paused = $2, automation_paused_reason = $3, updated_at = now() WHERE id = $1",
    [sourceId, paused, paused ? reason ?? "Paused by administrator" : null],
  );
  await ctx.db.query("INSERT INTO provider_health_events (source_id, kind, detail) VALUES ($1, $2, $3)", [sourceId, paused ? "AUTO_PAUSED" : "RESUMED", `admin:${adminId}`]);
  await audit(ctx, { actorId: adminId, actorType: "admin", action: paused ? "provider.paused" : "provider.resumed", targetType: "data_source", targetId: sourceId });
  invalidateRegistryCache();
}
