import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RATE_LIMITS } from "../../../../security/rate-limit";
import { ApprovalMode, CaseOutcome, IdentifierType, ProfileRelationship } from "../../../../shared/domain";
import { tooManyRequests } from "../../../../shared/errors";
import type { AppContext } from "../../context";
import { addIdentifier, createProfile, deleteIdentifier, getOwnedProfile, listIdentifiers, listProfiles, relayAlias, revealIdentifier, updateProfile } from "../../services/profiles";
import { requireUser } from "../app";
import { idParam, parse } from "../util";

const vals = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/profile", async (req, reply) => {
    const body = parse(
      z.object({
        label: z.string().min(1).max(80),
        relationship: z.enum(vals(ProfileRelationship)).default("SELF"),
        authorizationStatement: z.string().min(10).max(1000),
        attest: z.literal(true),
        jurisdictionCode: z.string().max(10).nullable().optional(),
        defaultApprovalMode: z.enum(vals(ApprovalMode)).optional(),
      }),
      req.body,
    );
    const p = await createProfile(ctx, requireUser(req), body);
    return reply.code(201).send({ profile: await profileView(ctx, p) });
  });

  app.get("/profile", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    const profiles = await listProfiles(ctx, user.id);
    return {
      profiles: await Promise.all(
        profiles.map(async (p) => ({ ...(await profileView(ctx, p)), identifiers: await listIdentifiers(ctx, p.id) })),
      ),
    };
  });

  app.patch("/profile/:id", async (req) => {
    const body = parse(
      z.object({
        label: z.string().min(1).max(80).optional(),
        jurisdictionCode: z.string().max(10).nullable().optional(),
        defaultApprovalMode: z.enum(vals(ApprovalMode)).optional(),
        blanketAuthorization: z.boolean().optional(),
        monitoringIntervalDays: z.number().int().optional(),
        monitoringEnabled: z.boolean().optional(),
        useRelayEmail: z.boolean().optional(),
        caseOutcome: z.enum(vals(CaseOutcome)).optional(),
      }),
      req.body,
    );
    const p = await updateProfile(ctx, requireUser(req), idParam(req), body);
    return { profile: await profileView(ctx, p) };
  });

  app.post("/profile/:id/identifiers", async (req, reply) => {
    const user = requireUser(req);
    const rl = await ctx.rateLimiter.hit(`idchg:${user.id}`, RATE_LIMITS.identifierChangesPerDay.limit, RATE_LIMITS.identifierChangesPerDay.windowSec);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    const body = parse(z.object({ type: z.enum(vals(IdentifierType)), value: z.string().min(1).max(320), isPrevious: z.boolean().optional() }), req.body);
    return reply.code(201).send({ identifier: await addIdentifier(ctx, user, idParam(req), body) });
  });

  app.get("/profile/:id/identifiers", async (req) => {
    const p = await getOwnedProfile(ctx, requireUser(req).id, idParam(req));
    return { identifiers: await listIdentifiers(ctx, p.id) };
  });

  // Field-level access: explicit reveal, rate limited and audited.
  app.post("/profile/:id/identifiers/:identifierId/reveal", async (req) => {
    const user = requireUser(req);
    const rl = await ctx.rateLimiter.hit(`reveal:${user.id}`, 30, 3600);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    return { value: await revealIdentifier(ctx, user, idParam(req), idParam(req, "identifierId")) };
  });

  app.delete("/profile/:id/identifiers/:identifierId", async (req) => {
    await deleteIdentifier(ctx, requireUser(req), idParam(req), idParam(req, "identifierId"));
    return { ok: true };
  });
}

async function profileView(ctx: AppContext, p: Awaited<ReturnType<typeof getOwnedProfile>>) {
  return {
    id: p.id,
    label: p.label,
    relationship: p.relationship,
    jurisdictionCode: p.jurisdiction_code,
    defaultApprovalMode: p.default_approval_mode,
    blanketAuthorization: !!p.blanket_authorization_at,
    monitoringIntervalDays: p.monitoring_interval_days,
    monitoringEnabled: p.monitoring_enabled,
    underReview: p.flagged_for_review,
    caseOutcome: p.case_outcome,
    relayEmail: await relayAlias(ctx, p),
    createdAt: p.created_at,
  };
}
