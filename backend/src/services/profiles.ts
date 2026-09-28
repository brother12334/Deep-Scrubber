import { randomBytes } from "node:crypto";
import { assessProfileAbuse, PLANS } from "../../../core/abuse";
import { normalizeIdentifier, normalizeName, validateIdentifier } from "../../../core/normalize";
import { buildSubject, type PlainIdentifier, type SubjectProfile } from "../../../core/subject";
import { maskIdentifier } from "../../../security/masking";
import {
  SENSITIVE_IDENTIFIER_TYPES,
  type ApprovalMode,
  type IdentifierType,
  type ProfileRelationship,
} from "../../../shared/domain";
import { badRequest, forbidden, notFound } from "../../../shared/errors";
import type { AppContext } from "../context";
import { audit } from "./audit";
import type { SessionUser } from "./users";
import { getUserEmail } from "./users";

export interface ProfileRow {
  id: string;
  user_id: string;
  label: string;
  relationship: ProfileRelationship;
  jurisdiction_code: string | null;
  default_approval_mode: ApprovalMode;
  blanket_authorization_at: Date | null;
  monitoring_interval_days: number;
  monitoring_enabled: boolean;
  flagged_for_review: boolean;
  relay_alias_ciphertext: string | null;
  created_at: Date;
}

const idAad = (profileId: string) => `identifier:${profileId}`;
const relayAad = (profileId: string) => `relay:${profileId}`;

export async function createProfile(
  ctx: AppContext,
  user: SessionUser,
  input: {
    label: string;
    relationship: ProfileRelationship;
    authorizationStatement: string;
    attest: boolean;
    jurisdictionCode?: string | null;
    defaultApprovalMode?: ApprovalMode;
  },
): Promise<ProfileRow> {
  const plan = PLANS[user.plan];
  if (!input.attest) throw badRequest("You must confirm you are authorized to manage this person's information.");
  if (!plan.allowedRelationships.includes(input.relationship)) {
    throw forbidden(`Your plan does not allow profiles for relationship "${input.relationship}".`);
  }
  const count = await ctx.db.one<{ n: number }>("SELECT count(*)::int AS n FROM privacy_profiles WHERE user_id = $1", [user.id]);
  if ((count?.n ?? 0) >= plan.maxProfiles) throw forbidden(`Your plan allows up to ${plan.maxProfiles} profile(s).`);
  if (input.jurisdictionCode && !(await ctx.db.one("SELECT 1 FROM jurisdictions WHERE code = $1", [input.jurisdictionCode]))) {
    throw badRequest("Unknown jurisdiction.");
  }
  const mode = input.defaultApprovalMode ?? "APPROVAL_REQUIRED";
  if (mode === "AUTOMATIC" && !plan.automatedRemoval) throw forbidden("Automatic removal requires a paid plan.");
  const row = await ctx.db.one<ProfileRow>(
    `INSERT INTO privacy_profiles (user_id, label, relationship, authorization_statement, authorization_attested_at, jurisdiction_code, default_approval_mode)
     VALUES ($1, $2, $3, $4, now(), $5, $6) RETURNING *`,
    [user.id, input.label.slice(0, 80), input.relationship, input.authorizationStatement.slice(0, 1000), input.jurisdictionCode ?? null, mode],
  );
  await audit(ctx, { actorId: user.id, actorType: "user", action: "profile.created", targetType: "profile", targetId: row!.id, metadata: { relationship: input.relationship } });
  return row!;
}

export async function listProfiles(ctx: AppContext, userId: string): Promise<ProfileRow[]> {
  return ctx.db.query<ProfileRow>("SELECT * FROM privacy_profiles WHERE user_id = $1 ORDER BY created_at", [userId]);
}

/** Ownership check used by every profile-scoped endpoint. */
export async function getOwnedProfile(ctx: AppContext, userId: string, profileId?: string): Promise<ProfileRow> {
  const row = profileId
    ? await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1 AND user_id = $2", [profileId, userId])
    : await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE user_id = $1 ORDER BY created_at LIMIT 1", [userId]);
  if (!row) throw notFound("Profile");
  return row;
}

export async function updateProfile(
  ctx: AppContext,
  user: SessionUser,
  profileId: string,
  patch: {
    label?: string;
    jurisdictionCode?: string | null;
    defaultApprovalMode?: ApprovalMode;
    blanketAuthorization?: boolean;
    monitoringIntervalDays?: number;
    monitoringEnabled?: boolean;
    useRelayEmail?: boolean;
  },
): Promise<ProfileRow> {
  const p = await getOwnedProfile(ctx, user.id, profileId);
  const plan = PLANS[user.plan];
  if (patch.defaultApprovalMode === "AUTOMATIC" && !plan.automatedRemoval) throw forbidden("Automatic removal requires a paid plan.");
  if (patch.blanketAuthorization && !plan.automatedRemoval) throw forbidden("Blanket authorization requires a paid plan.");
  if (patch.monitoringIntervalDays !== undefined && (patch.monitoringIntervalDays < 1 || patch.monitoringIntervalDays > 180)) {
    throw badRequest("Monitoring interval must be between 1 and 180 days.");
  }
  if (patch.monitoringEnabled && !plan.continuousMonitoring) throw forbidden("Continuous monitoring requires a paid plan.");
  let relayCipher = p.relay_alias_ciphertext;
  let relayHash: string | null | undefined;
  if (patch.useRelayEmail === true && !relayCipher) {
    const alias = `r${randomBytes(8).toString("hex")}@${ctx.cfg.REMOVAL_REPLY_TO_DOMAIN}`;
    relayCipher = ctx.cipher.encrypt(alias, relayAad(p.id));
    relayHash = ctx.cipher.blindIndex(alias, "relay");
  } else if (patch.useRelayEmail === false) {
    relayCipher = null;
    relayHash = null;
  }
  const row = await ctx.db.one<ProfileRow>(
    `UPDATE privacy_profiles SET
       label = COALESCE($2, label),
       jurisdiction_code = CASE WHEN $3::boolean THEN $4 ELSE jurisdiction_code END,
       default_approval_mode = COALESCE($5, default_approval_mode),
       blanket_authorization_at = CASE WHEN $6::boolean IS NULL THEN blanket_authorization_at WHEN $6 THEN now() ELSE NULL END,
       monitoring_interval_days = COALESCE($7, monitoring_interval_days),
       monitoring_enabled = COALESCE($8, monitoring_enabled),
       relay_alias_ciphertext = $9,
       relay_alias_hash = CASE WHEN $10::boolean THEN $11 ELSE relay_alias_hash END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      p.id,
      patch.label ?? null,
      patch.jurisdictionCode !== undefined,
      patch.jurisdictionCode ?? null,
      patch.defaultApprovalMode ?? null,
      patch.blanketAuthorization ?? null,
      patch.monitoringIntervalDays ?? null,
      patch.monitoringEnabled ?? null,
      relayCipher,
      relayHash !== undefined,
      relayHash ?? null,
    ],
  );
  await audit(ctx, {
    actorId: user.id,
    actorType: "user",
    action: "profile.updated",
    targetType: "profile",
    targetId: p.id,
    metadata: { fields: Object.keys(patch), blanketAuthorization: patch.blanketAuthorization },
  });
  return row!;
}

export async function relayAlias(ctx: AppContext, p: Pick<ProfileRow, "id" | "relay_alias_ciphertext">): Promise<string | null> {
  return p.relay_alias_ciphertext ? ctx.cipher.decrypt(p.relay_alias_ciphertext, relayAad(p.id)) : null;
}

// ---- Identifiers -----------------------------------------------------------

export interface IdentifierView {
  id: string;
  type: IdentifierType;
  displayValue: string;
  masked: boolean;
  isPrevious: boolean;
  createdAt: Date;
}

export async function listIdentifiers(ctx: AppContext, profileId: string): Promise<IdentifierView[]> {
  const rows = await ctx.db.query<{ id: string; type: IdentifierType; display_hint: string; value_ciphertext: string; is_previous: boolean; created_at: Date }>(
    "SELECT id, type, display_hint, value_ciphertext, is_previous, created_at FROM identifiers WHERE profile_id = $1 ORDER BY type, created_at",
    [profileId],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    // Sensitive values are only ever shown masked; others are decrypted for display.
    displayValue: SENSITIVE_IDENTIFIER_TYPES.has(r.type) ? r.display_hint : ctx.cipher.decrypt(r.value_ciphertext, idAad(profileId)),
    masked: SENSITIVE_IDENTIFIER_TYPES.has(r.type),
    isPrevious: r.is_previous,
    createdAt: r.created_at,
  }));
}

export async function addIdentifier(
  ctx: AppContext,
  user: SessionUser,
  profileId: string,
  input: { type: IdentifierType; value: string; isPrevious?: boolean },
): Promise<IdentifierView> {
  const p = await getOwnedProfile(ctx, user.id, profileId);
  const err = validateIdentifier(input.type, input.value);
  if (err) throw badRequest(err);
  const plan = PLANS[user.plan];
  const counts = await ctx.db.one<{ same: number; names: number }>(
    `SELECT count(*) FILTER (WHERE type = $2)::int AS same,
            count(*) FILTER (WHERE type IN ('FULL_NAME','ALIAS'))::int AS names
     FROM identifiers WHERE profile_id = $1`,
    [p.id, input.type],
  );
  if ((counts?.same ?? 0) >= plan.maxIdentifiersPerType) throw forbidden(`Your plan allows up to ${plan.maxIdentifiersPerType} of this identifier type.`);
  if ((input.type === "FULL_NAME" || input.type === "ALIAS") && (counts?.names ?? 0) >= plan.maxNamesPerProfile) {
    throw forbidden(`A profile can have at most ${plan.maxNamesPerProfile} names. Profiles are for one person.`);
  }
  if (input.type === "DATE_OF_BIRTH" && (counts?.same ?? 0) >= 1) throw badRequest("Only one date of birth can be stored.");

  const normalized = normalizeIdentifier(input.type, input.value);
  const hash = ctx.cipher.blindIndex(normalized, `id:${input.type}`);
  const display = maskIdentifier(input.type, input.value.trim());
  // Only masked hints are stored in plaintext; non-sensitive values are decrypted on read.
  const storedHint = SENSITIVE_IDENTIFIER_TYPES.has(input.type) ? display : "";
  const row = await ctx.db.one<{ id: string; created_at: Date }>(
    `INSERT INTO identifiers (profile_id, type, value_ciphertext, value_hash, display_hint, is_previous)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id, type, value_hash) DO NOTHING RETURNING id, created_at`,
    [p.id, input.type, ctx.cipher.encrypt(input.value.trim(), idAad(p.id)), hash, storedHint, !!input.isPrevious],
  );
  if (!row) throw badRequest("This identifier is already on your profile.");
  await audit(ctx, { actorId: user.id, actorType: "user", action: "identifier.added", targetType: "profile", targetId: p.id, metadata: { type: input.type } });
  await runAbuseChecks(ctx, user.id, p.id);
  return { id: row.id, type: input.type, displayValue: display, masked: SENSITIVE_IDENTIFIER_TYPES.has(input.type), isPrevious: !!input.isPrevious, createdAt: row.created_at };
}

/** Field-level access: explicit, audited reveal of one sensitive value. */
export async function revealIdentifier(ctx: AppContext, user: SessionUser, profileId: string, identifierId: string): Promise<string> {
  const p = await getOwnedProfile(ctx, user.id, profileId);
  const row = await ctx.db.one<{ value_ciphertext: string; type: string }>(
    "SELECT value_ciphertext, type FROM identifiers WHERE id = $1 AND profile_id = $2",
    [identifierId, p.id],
  );
  if (!row) throw notFound("Identifier");
  await audit(ctx, { actorId: user.id, actorType: "user", action: "identifier.revealed", targetType: "profile", targetId: p.id, metadata: { type: row.type } });
  return ctx.cipher.decrypt(row.value_ciphertext, idAad(p.id));
}

export async function deleteIdentifier(ctx: AppContext, user: SessionUser, profileId: string, identifierId: string): Promise<void> {
  const p = await getOwnedProfile(ctx, user.id, profileId);
  const row = await ctx.db.one<{ type: string }>("DELETE FROM identifiers WHERE id = $1 AND profile_id = $2 RETURNING type", [identifierId, p.id]);
  if (!row) throw notFound("Identifier");
  await audit(ctx, { actorId: user.id, actorType: "user", action: "identifier.deleted", targetType: "profile", targetId: p.id, metadata: { type: row.type } });
}

/** Decrypt a profile into memory for discovery/removal. Never persist or log the result. */
export async function loadSubject(ctx: AppContext, profileId: string): Promise<SubjectProfile> {
  const p = await ctx.db.one<ProfileRow>("SELECT * FROM privacy_profiles WHERE id = $1", [profileId]);
  if (!p) throw notFound("Profile");
  const rows = await ctx.db.query<{ type: IdentifierType; value_ciphertext: string; is_previous: boolean }>(
    "SELECT type, value_ciphertext, is_previous FROM identifiers WHERE profile_id = $1",
    [profileId],
  );
  const ids: PlainIdentifier[] = rows.map((r) => ({ type: r.type, value: ctx.cipher.decrypt(r.value_ciphertext, idAad(profileId)), isPrevious: r.is_previous }));
  const relay = await relayAlias(ctx, p);
  let contact: { email: string; isRelay: boolean } | undefined;
  if (relay) contact = { email: relay, isRelay: true };
  else {
    const firstEmail = ids.find((i) => i.type === "EMAIL" && !i.isPrevious)?.value;
    contact = { email: firstEmail ?? (await getUserEmail(ctx, p.user_id)), isRelay: false };
  }
  return buildSubject(profileId, ids, contact);
}

/** Abuse heuristics (spec §29): flag profiles that look like they target other people. */
export async function runAbuseChecks(ctx: AppContext, userId: string, profileId: string): Promise<void> {
  const ids = await ctx.db.query<{ type: IdentifierType; value_ciphertext: string; value_hash: string }>(
    "SELECT type, value_ciphertext, value_hash FROM identifiers WHERE profile_id = $1",
    [profileId],
  );
  const names = ids.filter((i) => i.type === "FULL_NAME" || i.type === "ALIAS").map((i) => normalizeName(ctx.cipher.decrypt(i.value_ciphertext, idAad(profileId))));
  const lastNames = new Set(names.map((n) => n.split(" ").pop()));
  const claimed = await ctx.db.one<{ emails: number; phones: number }>(
    `SELECT count(*) FILTER (WHERE i.type = 'EMAIL')::int AS emails, count(*) FILTER (WHERE i.type = 'PHONE')::int AS phones
     FROM identifiers i JOIN privacy_profiles p ON p.id = i.profile_id
     WHERE p.user_id <> $1 AND (i.type, i.value_hash) IN (SELECT type, value_hash FROM identifiers WHERE profile_id = $2 AND type IN ('EMAIL','PHONE'))`,
    [userId, profileId],
  );
  const churn = await ctx.db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_logs WHERE actor_user_id = $1 AND action IN ('identifier.added','identifier.deleted') AND created_at > now() - interval '24 hours'`,
    [userId],
  );
  const signals = assessProfileAbuse({
    distinctNames: names.length,
    distinctLastNames: lastNames.size,
    emailsClaimedByOtherAccounts: claimed?.emails ?? 0,
    phonesClaimedByOtherAccounts: claimed?.phones ?? 0,
    identifierChurnLast24h: churn?.n ?? 0,
  });
  if (signals.some((s) => s.severity === "block")) {
    throw forbidden("Too many profile changes. Please contact support if you need help.");
  }
  const review = signals.filter((s) => s.severity === "review");
  if (review.length) {
    const already = await ctx.db.one<{ flagged_for_review: boolean }>("SELECT flagged_for_review FROM privacy_profiles WHERE id = $1", [profileId]);
    if (!already?.flagged_for_review) {
      await ctx.db.query("UPDATE privacy_profiles SET flagged_for_review = true WHERE id = $1", [profileId]);
      await ctx.db.query(
        `INSERT INTO abuse_reports (subject_user_id, category, description, source) VALUES ($1, $2, $3, 'automated')`,
        [userId, review.map((s) => s.code).join(","), review.map((s) => s.detail).join(" ")],
      );
      await audit(ctx, { actorType: "system", action: "abuse.profile_flagged", targetType: "profile", targetId: profileId, metadata: { codes: review.map((s) => s.code) } });
    }
  }
}
