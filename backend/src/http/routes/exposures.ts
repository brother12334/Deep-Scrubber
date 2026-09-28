import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STATUS_EXPLANATIONS } from "../../../../ai/explain";
import type { AppContext } from "../../context";
import { audit } from "../../services/audit";
import { exposureMap, getOwnedRecord, listClusters, listExposures, setRecordStatus, toView } from "../../services/records";
import { getPathways, planRemoval } from "../../services/removals";
import { createScan, getScan } from "../../services/scans";
import { idParam, parse, profileFor } from "../util";

export function registerExposureRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/scans", async (req, reply) => {
    const { user, profile } = await profileFor(ctx, req);
    const body = parse(z.object({ topics: z.array(z.string()).max(10).optional(), customTerms: z.array(z.string().max(60)).max(10).optional() }), req.body);
    const scan = await createScan(ctx, user, profile.id, "USER", body);
    return reply.code(202).send({ scan });
  });

  app.get("/scans", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return { scans: await ctx.db.query("SELECT id, trigger, status, stats, focus, created_at, finished_at FROM scans WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 50", [profile.id]) };
  });

  app.get("/scans/:id", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return { scan: await getScan(ctx, profile.id, idParam(req)) };
  });

  app.get("/exposures", async (req) => {
    const { profile } = await profileFor(ctx, req);
    const q = parse(
      z.object({
        status: z.string().max(300).optional(),
        category: z.string().max(300).optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
        includeSearch: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        profileId: z.string().optional(),
      }),
      req.query,
    );
    return listExposures(ctx, profile.id, { ...q, includeSearch: q.includeSearch === undefined ? undefined : q.includeSearch === "true" });
  });

  app.get("/exposures/clusters", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return { clusters: await listClusters(ctx, profile.id) };
  });

  app.get("/exposures/map", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return exposureMap(ctx, profile.id);
  });

  app.get("/exposures/:id", async (req) => {
    const { profile } = await profileFor(ctx, req);
    const r = await getOwnedRecord(ctx, profile.id, idParam(req));
    const view = await toView(ctx, r);
    const children = await ctx.db.query<{ id: string }>("SELECT id FROM discovered_records WHERE parent_record_id = $1", [r.id]);
    const requests = await ctx.db.query("SELECT id, status, method, pathway, submitted_at, completed_at FROM removal_requests WHERE record_id = $1 ORDER BY created_at DESC", [r.id]);
    const checks = await ctx.db.query("SELECT kind, outcome, method, checked_at FROM verification_checks WHERE record_id = $1 ORDER BY checked_at DESC LIMIT 20", [r.id]);
    return {
      exposure: view,
      explanation: STATUS_EXPLANATIONS[r.status],
      pathways: await getPathways(ctx, r),
      downstreamIds: children.map((c) => c.id),
      requests,
      verificationChecks: checks,
    };
  });

  /** "Yes, this is me" — the only way a weak/possible match becomes actionable. */
  app.post("/exposures/:id/confirm", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const r = await getOwnedRecord(ctx, profile.id, idParam(req));
    await ctx.db.query("UPDATE discovered_records SET user_confirmed = true, status = CASE WHEN status = 'NEEDS_REVIEW' THEN 'DISCOVERED' ELSE status END, updated_at = now() WHERE id = $1", [r.id]);
    await audit(ctx, { actorId: user.id, actorType: "user", action: "exposure.confirmed", targetType: "record", targetId: r.id });
    const requestId = await planRemoval(ctx, r.id, { initiatedBy: user.id });
    return { ok: true, requestId };
  });

  app.post("/exposures/:id/dismiss", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const r = await getOwnedRecord(ctx, profile.id, idParam(req));
    await ctx.db.query("UPDATE discovered_records SET user_confirmed = false, updated_at = now() WHERE id = $1", [r.id]);
    await setRecordStatus(ctx, r.id, "DISMISSED", "You marked this as not you.");
    await ctx.db.query("UPDATE removal_requests SET status = 'CANCELLED', updated_at = now() WHERE record_id = $1 AND status IN ('AWAITING_APPROVAL','REQUIRES_USER_ACTION','DRAFT')", [r.id]);
    await audit(ctx, { actorId: user.id, actorType: "user", action: "exposure.dismissed", targetType: "record", targetId: r.id });
    return { ok: true };
  });
}
