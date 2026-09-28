import type { AppContext } from "../context";

/**
 * Data minimisation (spec §22): the service must not become a data broker.
 * Runs hourly and permanently deletes expired data.
 */
export async function retentionSweep(ctx: AppContext) {
  const out: Record<string, number> = {};
  // Temporary identity documents: strict TTL.
  const docs = await ctx.db.query<{ id: string; storage_key: string }>(
    "DELETE FROM temp_documents WHERE expires_at <= $1 RETURNING id, storage_key",
    [ctx.clock.now()],
  );
  for (const d of docs) await ctx.storage.delete(d.storage_key).catch(() => undefined);
  out.tempDocuments = docs.length;

  out.sessions = (await ctx.db.query("DELETE FROM sessions WHERE expires_at <= now() RETURNING id")).length;
  out.emailTokens = (await ctx.db.query("DELETE FROM email_tokens WHERE expires_at <= now() - interval '7 days' RETURNING token_hash")).length;
  out.inboundEmails = (await ctx.db.query("DELETE FROM inbound_emails WHERE received_at <= now() - interval '7 days' OR consumed_at <= now() - interval '1 day' RETURNING id")).length;

  // Snippets/attributes are only needed while a record is active; purge per user retention.
  out.recordPayloads = (
    await ctx.db.query(
      `UPDATE discovered_records d SET snippet_ciphertext = NULL, attributes_ciphertext = NULL
       FROM privacy_profiles p JOIN user_settings s ON s.user_id = p.user_id
       WHERE d.profile_id = p.id AND (d.snippet_ciphertext IS NOT NULL OR d.attributes_ciphertext IS NOT NULL)
         AND d.status IN ('REMOVED','DISMISSED') AND d.updated_at < now() - make_interval(days => s.record_retention_days)
       RETURNING d.id`,
    )
  ).length;
  out.dismissedRecords = (
    await ctx.db.query(
      `DELETE FROM discovered_records d USING privacy_profiles p, user_settings s
       WHERE d.profile_id = p.id AND s.user_id = p.user_id AND d.status = 'DISMISSED'
         AND d.updated_at < now() - make_interval(days => s.record_retention_days) RETURNING d.id`,
    )
  ).length;
  out.notifications = (await ctx.db.query("DELETE FROM notifications WHERE created_at < now() - interval '180 days' RETURNING id")).length;
  out.healthEvents = (await ctx.db.query("DELETE FROM provider_health_events WHERE created_at < now() - interval '90 days' RETURNING id")).length;
  // Audit logs are append-only for updates; deletion by age is the only permitted mutation.
  out.auditLogs = (
    await ctx.db.query("DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1) RETURNING id", [ctx.cfg.AUDIT_LOG_RETENTION_DAYS])
  ).length;
  return out;
}
