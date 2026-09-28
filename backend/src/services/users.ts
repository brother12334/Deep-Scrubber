import { normalizeEmail } from "../../../core/normalize";
import { randomToken, sha256Hex } from "../../../security/crypto";
import { hashPassword, needsRehash, validatePasswordPolicy, verifyPassword } from "../../../security/password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../../security/totp";
import type { PlanId, UserRole } from "../../../shared/domain";
import { AppError, badRequest, conflict, unauthorized } from "../../../shared/errors";
import type { AppContext } from "../context";
import { audit } from "./audit";

export interface UserRow {
  id: string;
  role: UserRole;
  status: "active" | "suspended";
  plan: PlanId;
  email_verified_at: Date | null;
  mfa_enabled_at: Date | null;
  password_hash: string;
  email_ciphertext: string;
  mfa_secret_ciphertext: string | null;
}

export interface SessionUser {
  id: string;
  role: UserRole;
  plan: PlanId;
  emailVerified: boolean;
  mfaEnabled: boolean;
  sessionId: string;
  csrfToken: string;
  mfaVerified: boolean;
}

const emailAad = (userId: string) => `user-email:${userId}`;

export function emailHash(ctx: AppContext, email: string): string {
  return ctx.cipher.blindIndex(normalizeEmail(email), "user-email");
}

export async function getUserEmail(ctx: AppContext, userId: string): Promise<string> {
  const row = await ctx.db.one<{ email_ciphertext: string }>("SELECT email_ciphertext FROM users WHERE id = $1", [userId]);
  if (!row) throw new AppError("NOT_FOUND", "User not found", 404);
  return ctx.cipher.decrypt(row.email_ciphertext, emailAad(userId));
}

export async function signup(
  ctx: AppContext,
  input: { email: string; password: string; acceptTerms: boolean },
  ip?: string,
): Promise<{ userId: string; verificationToken: string }> {
  if (!input.acceptTerms) throw badRequest("You must accept the Terms of Service.");
  const policy = validatePasswordPolicy(input.password);
  if (policy) throw badRequest(policy);
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address.");
  const hash = emailHash(ctx, email);
  if (await ctx.db.one("SELECT 1 FROM users WHERE email_hash = $1", [hash])) throw conflict("An account with this email already exists.");

  const passwordHash = await hashPassword(input.password);
  const userId = await ctx.db.tx(async (c) => {
    const id = (await c.query<{ id: string }>("SELECT gen_random_uuid() AS id")).rows[0]!.id;
    await c.query(
      `INSERT INTO users (id, email_ciphertext, email_hash, password_hash, terms_accepted_at) VALUES ($1, $2, $3, $4, now())`,
      [id, ctx.cipher.encrypt(email, emailAad(id)), hash, passwordHash],
    );
    await c.query("INSERT INTO user_settings (user_id, record_retention_days) VALUES ($1, $2)", [id, ctx.cfg.DEFAULT_RECORD_RETENTION_DAYS]);
    return id;
  });
  const verificationToken = await issueEmailToken(ctx, userId, "verify_email");
  await ctx.mailer.send({
    to: email,
    subject: "Verify your Deep Scrubber account",
    text: `Confirm your email to start protecting your privacy:\n\n${ctx.cfg.PUBLIC_APP_URL}/verify-email?token=${verificationToken}\n\nIf you didn't sign up, ignore this message.`,
  });
  await audit(ctx, { actorId: userId, actorType: "user", action: "account.signup", targetType: "user", targetId: userId, ip });
  return { userId, verificationToken };
}

export async function issueEmailToken(ctx: AppContext, userId: string, purpose: "verify_email" | "reset_password"): Promise<string> {
  const token = randomToken(32);
  await ctx.db.query(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + interval '24 hours')",
    [sha256Hex(token), userId, purpose],
  );
  return token;
}

export async function verifyEmail(ctx: AppContext, token: string): Promise<string> {
  const row = await ctx.db.one<{ user_id: string }>(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [sha256Hex(token)],
  );
  if (!row) throw badRequest("This verification link is invalid or has expired.");
  await ctx.db.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [row.user_id]);
  await audit(ctx, { actorId: row.user_id, actorType: "user", action: "account.email_verified", targetType: "user", targetId: row.user_id });
  return row.user_id;
}

// A real hash so that timing for unknown emails matches known ones.
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

export async function login(
  ctx: AppContext,
  input: { email: string; password: string },
  ip?: string,
): Promise<{ token: string; user: SessionUser }> {
  const row = await ctx.db.one<UserRow>("SELECT * FROM users WHERE email_hash = $1", [emailHash(ctx, input.email)]);
  const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    await audit(ctx, { actorType: "system", action: "auth.login_failed", ip });
    throw unauthorized("Incorrect email or password.");
  }
  if (row.status !== "active") throw new AppError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support.", 403);
  if (needsRehash(row.password_hash)) {
    await ctx.db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [row.id, await hashPassword(input.password)]);
  }
  const session = await createSession(ctx, row.id, ip);
  await audit(ctx, { actorId: row.id, actorType: row.role === "admin" ? "admin" : "user", action: "auth.login", targetType: "user", targetId: row.id, ip });
  return { token: session.token, user: toSessionUser(row, session.id, session.csrf, false) };
}

async function createSession(ctx: AppContext, userId: string, ip?: string) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const row = await ctx.db.one<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5)) RETURNING id`,
    [userId, sha256Hex(token), csrf, ip ? sha256Hex(ip + ctx.cfg.LOG_HASH_KEY).slice(0, 24) : null, ctx.cfg.SESSION_TTL_HOURS],
  );
  return { token, csrf, id: row!.id };
}

function toSessionUser(u: UserRow, sessionId: string, csrfToken: string, mfaVerified: boolean): SessionUser {
  return {
    id: u.id,
    role: u.role,
    plan: u.plan,
    emailVerified: !!u.email_verified_at,
    mfaEnabled: !!u.mfa_enabled_at,
    sessionId,
    csrfToken,
    mfaVerified,
  };
}

export async function authenticate(ctx: AppContext, token: string): Promise<SessionUser | null> {
  const row = await ctx.db.one<UserRow & { session_id: string; csrf_token: string; mfa_verified: boolean }>(
    `SELECT u.*, s.id AS session_id, s.csrf_token, s.mfa_verified
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256Hex(token)],
  );
  if (!row || row.status !== "active") return null;
  await ctx.db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'", [row.session_id]);
  return toSessionUser(row, row.session_id, row.csrf_token, row.mfa_verified);
}

export async function logout(ctx: AppContext, sessionId: string): Promise<void> {
  await ctx.db.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function setupMfa(ctx: AppContext, userId: string): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret();
  await ctx.db.query("UPDATE users SET mfa_secret_ciphertext = $2, mfa_enabled_at = NULL WHERE id = $1", [
    userId,
    ctx.cipher.encrypt(secret, `mfa:${userId}`),
  ]);
  return { secret, otpauthUri: otpauthUri(secret, `user-${userId.slice(0, 8)}`) };
}

export async function verifyMfa(ctx: AppContext, user: SessionUser, code: string, enable: boolean): Promise<void> {
  const row = await ctx.db.one<{ mfa_secret_ciphertext: string | null }>("SELECT mfa_secret_ciphertext FROM users WHERE id = $1", [user.id]);
  if (!row?.mfa_secret_ciphertext) throw badRequest("MFA is not set up.");
  const secret = ctx.cipher.decrypt(row.mfa_secret_ciphertext, `mfa:${user.id}`);
  if (!verifyTotp(secret, code, ctx.clock.now().getTime())) throw unauthorized("Invalid code.");
  if (enable) await ctx.db.query("UPDATE users SET mfa_enabled_at = now() WHERE id = $1", [user.id]);
  await ctx.db.query("UPDATE sessions SET mfa_verified = true WHERE id = $1", [user.sessionId]);
  await audit(ctx, { actorId: user.id, actorType: user.role === "admin" ? "admin" : "user", action: enable ? "auth.mfa_enabled" : "auth.mfa_verified" });
}
