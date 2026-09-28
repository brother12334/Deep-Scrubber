import type { AppContext } from "../context";
import { audit } from "./audit";
import { listIdentifiers, listProfiles, revealIdentifierValues } from "./profiles-export";
import { listExposures } from "./records";
import { getUserEmail } from "./users";

/** Export everything we hold about the account holder (spec §22). */
export async function exportAccount(ctx: AppContext, userId: string) {
  const profiles = await listProfiles(ctx, userId);
  const out = [];
  for (const p of profiles) {
    out.push({
      profile: { id: p.id, label: p.label, relationship: p.relationship, jurisdiction: p.jurisdiction_code, createdAt: p.created_at },
      identifiers: await revealIdentifierValues(ctx, p.id),
      identifierSummary: await listIdentifiers(ctx, p.id),
      exposures: (await listExposures(ctx, p.id, { limit: 200 })).items,
      removalRequests: await ctx.db.query(
        "SELECT id, record_id, source_id, method, pathway, status, submitted_at, confirmation_ref, completed_at, created_at FROM removal_requests WHERE profile_id = $1",
        [p.id],
      ),
      verificationChecks: await ctx.db.query(
        "SELECT v.record_id, v.kind, v.outcome, v.method, v.checked_at FROM verification_checks v JOIN discovered_records d ON d.id = v.record_id WHERE d.profile_id = $1",
        [p.id],
      ),
    });
  }
  await audit(ctx, { actorId: userId, actorType: "user", action: "account.exported" });
  return {
    exportedAt: ctx.clock.now().toISOString(),
    account: { id: userId, email: await getUserEmail(ctx, userId) },
    settings: await ctx.db.one("SELECT notify_email, notify_push, notify_in_app, record_retention_days FROM user_settings WHERE user_id = $1", [userId]),
    profiles: out,
    notifications: await ctx.db.query("SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = $1", [userId]),
  };
}

/** Permanently delete the account and all associated data (cascade). */
export async function deleteAccount(ctx: AppContext, userId: string) {
  const docs = await ctx.db.query<{ storage_key: string }>("SELECT storage_key FROM temp_documents WHERE user_id = $1", [userId]);
  for (const d of docs) await ctx.storage.delete(d.storage_key).catch(() => undefined);
  await ctx.db.query("DELETE FROM users WHERE id = $1", [userId]);
  // Only the (now dangling) id remains in the audit trail.
  await audit(ctx, { actorType: "system", action: "account.deleted", targetType: "user", targetId: userId });
}
