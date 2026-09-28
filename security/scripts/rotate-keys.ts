import { closeContext, createContext } from "../../backend/src/context";
import { MemoryJobQueue } from "../../backend/src/infra/queue";
import { MemoryRateLimiter } from "../rate-limit";

/**
 * Re-encrypt every field-encrypted column with the active key.
 *
 * Rotation procedure:
 *   1. Add a new key to ENCRYPTION_KEYS (keep the old one), set ENCRYPTION_ACTIVE_KEY_ID to it, deploy.
 *      New writes use the new key; old ciphertexts still decrypt.
 *   2. Run `npm run keys:rotate`. It is idempotent and resumable.
 *   3. Once it reports 0 remaining, remove the old key and deploy again.
 *
 * The BLIND_INDEX_KEY cannot be rotated this way (indexes would need rebuilding from
 * plaintext); see docs/security.md.
 */
interface Target {
  table: string;
  id: string;
  columns: string[];
  /** SQL expression producing the AAD for a row. */
  aad: string;
  join?: string;
}

const TARGETS: Target[] = [
  { table: "users", id: "id", columns: ["email_ciphertext"], aad: "'user-email:' || t.id" },
  { table: "users", id: "id", columns: ["mfa_secret_ciphertext"], aad: "'mfa:' || t.id" },
  { table: "identifiers", id: "id", columns: ["value_ciphertext"], aad: "'identifier:' || t.profile_id" },
  { table: "privacy_profiles", id: "id", columns: ["relay_alias_ciphertext"], aad: "'relay:' || t.id" },
  { table: "discovered_records", id: "id", columns: ["url_ciphertext", "title_ciphertext", "snippet_ciphertext", "attributes_ciphertext"], aad: "'record:' || t.profile_id" },
  { table: "removal_requests", id: "id", columns: ["request_body_ciphertext"], aad: "'request:' || t.profile_id" },
  { table: "inbound_emails", id: "id", columns: ["subject_ciphertext", "body_ciphertext"], aad: "'inbound:' || t.profile_id" },
  { table: "push_subscriptions", id: "id", columns: ["subscription_ciphertext"], aad: "'push:' || t.user_id" },
  { table: "abuse_reports", id: "id", columns: ["reporter_contact_ciphertext"], aad: "'abuse-contact'" },
];

const ctx = createContext({ queue: new MemoryJobQueue(), rateLimiter: new MemoryRateLimiter() });
const active = ctx.cfg.ENCRYPTION_ACTIVE_KEY_ID;

async function run() {
  let total = 0;
  for (const t of TARGETS) {
    for (const col of t.columns) {
      for (;;) {
        const rows = await ctx.db.query<{ id: string; ct: string; aad: string }>(
          `SELECT t.${t.id}::text AS id, t.${col} AS ct, ${t.aad} AS aad FROM ${t.table} t
           WHERE t.${col} IS NOT NULL AND split_part(t.${col}, '.', 1) <> $1 LIMIT 500`,
          [active],
        );
        if (!rows.length) break;
        for (const r of rows) {
          const plain = ctx.cipher.decrypt(r.ct, r.aad);
          await ctx.db.query(`UPDATE ${t.table} SET ${col} = $2 WHERE ${t.id}::text = $1 AND ${col} = $3`, [r.id, ctx.cipher.encrypt(plain, r.aad), r.ct]);
        }
        total += rows.length;
        console.log(`${t.table}.${col}: re-encrypted ${rows.length}`);
      }
    }
  }
  // Workflow secure context lives inside JSON.
  const wfs = await ctx.db.query<{ id: string; profile_id: string; context: Record<string, unknown> }>(
    `SELECT w.id, r.profile_id, w.context FROM removal_workflows w JOIN removal_requests r ON r.id = w.request_id
     WHERE w.context ? '__secure' AND split_part(w.context->>'__secure', '.', 1) <> $1`,
    [active],
  );
  for (const w of wfs) {
    const aad = `workflow:${w.profile_id}`;
    const secure = ctx.cipher.decrypt(String(w.context.__secure), aad);
    await ctx.db.query("UPDATE removal_workflows SET context = $2 WHERE id = $1", [w.id, JSON.stringify({ ...w.context, __secure: ctx.cipher.encrypt(secure, aad) })]);
  }
  total += wfs.length;
  console.log(`done: ${total} value(s) re-encrypted with key "${active}"`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeContext(ctx));
