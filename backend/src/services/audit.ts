import type { Queryable } from "../../../database/db";
import { pseudonymize } from "../../../security/crypto";
import type { AppContext } from "../context";

export type ActorType = "user" | "admin" | "system" | "worker";

/**
 * Append-only audit trail (spec §18, §29). Metadata must contain ids and
 * enums only — never identifiers, snippets or request bodies.
 */
export async function audit(
  ctx: AppContext,
  e: { actorId?: string | null; actorType: ActorType; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; ip?: string },
  client?: Queryable,
): Promise<void> {
  await ctx.db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_type, action, target_type, target_id, metadata, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.actorId ?? null,
      e.actorType,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      JSON.stringify(e.metadata ?? {}),
      e.ip ? pseudonymize(e.ip, ctx.cfg.LOG_HASH_KEY) : null,
    ],
    client,
  );
}
