import { createHmac } from "node:crypto";
import { constantTimeEqual } from "../../../security/crypto";
import { badRequest, unauthorized } from "../../../shared/errors";
import type { AppContext } from "../context";

/**
 * Inbound mail for relay aliases. An MTA / email API (e.g. an inbound-parse
 * webhook) POSTs messages here, signed with INBOUND_EMAIL_SECRET. Messages to
 * unknown aliases are dropped; stored bodies are encrypted and short-lived.
 */
export function verifyInboundSignature(secret: string | undefined, rawBody: string, signature: string | undefined): void {
  if (!secret) throw unauthorized("Inbound email is not configured.");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!signature || !constantTimeEqual(expected, signature)) throw unauthorized("Bad signature.");
}

export async function receiveInboundEmail(ctx: AppContext, msg: { to: string; from: string; subject: string; text: string }): Promise<boolean> {
  const to = msg.to.trim().toLowerCase();
  const fromDomain = msg.from.split("@")[1]?.replace(/>.*$/, "").trim().toLowerCase();
  if (!fromDomain) throw badRequest("Invalid sender.");
  const profile = await ctx.db.one<{ id: string }>("SELECT id FROM privacy_profiles WHERE relay_alias_hash = $1", [ctx.cipher.blindIndex(to, "relay")]);
  if (!profile) return false;
  await ctx.db.query(
    "INSERT INTO inbound_emails (profile_id, from_domain, subject_ciphertext, body_ciphertext, received_at) VALUES ($1, $2, $3, $4, $5)",
    [
      profile.id,
      fromDomain,
      ctx.cipher.encrypt(msg.subject.slice(0, 500), `inbound:${profile.id}`),
      ctx.cipher.encrypt(msg.text.slice(0, 50_000), `inbound:${profile.id}`),
      ctx.clock.now(),
    ],
  );
  return true;
}
