import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../context";
import {
  activateWorkflowVersion,
  auditTrail,
  createWorkflowVersion,
  disableWorkflowVersion,
  listAbuseReports,
  listFailedJobs,
  listWorkflowVersions,
  proposeWorkflowFix,
  providersOverview,
  resolveFailedJob,
  retryFailedJob,
  setProviderEnabled,
  systemMetrics,
  updateAbuseReport,
  upsertProvider,
} from "../../services/admin";
import { evaluateProviderHealth, setProviderPaused } from "../../services/health";
import { requireUser } from "../app";
import { parse } from "../util";

const admin = { config: { auth: "admin" as const } };

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const sid = (params: unknown) => {
    const id = (params as { sourceId: string }).sourceId;
    return z.string().regex(/^[a-z0-9-]{2,64}$/).parse(id);
  };

  app.get("/admin/metrics", admin, async () => systemMetrics(ctx));
  app.get("/admin/providers", admin, async () => ({ providers: await providersOverview(ctx) }));
  app.post("/admin/providers", admin, async (req) => ({ provider: await upsertProvider(ctx, requireUser(req).id, req.body) }));
  app.post("/admin/providers/:sourceId/enabled", admin, async (req) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await setProviderEnabled(ctx, requireUser(req).id, sid(req.params), enabled);
    return { ok: true };
  });
  app.post("/admin/providers/:sourceId/pause", admin, async (req) => {
    const { paused, reason } = parse(z.object({ paused: z.boolean(), reason: z.string().max(300).optional() }), req.body);
    await setProviderPaused(ctx, requireUser(req).id, sid(req.params), paused, reason);
    return { ok: true };
  });
  app.get("/admin/providers/:sourceId/workflows", admin, async (req) => ({ versions: await listWorkflowVersions(ctx, sid(req.params)) }));
  app.post("/admin/providers/:sourceId/workflows", admin, async (req) => {
    const { definition, changelog } = parse(z.object({ definition: z.unknown(), changelog: z.string().min(3).max(2000) }), req.body);
    return createWorkflowVersion(ctx, requireUser(req).id, sid(req.params), definition, changelog);
  });
  app.post("/admin/providers/:sourceId/workflows/:version/activate", admin, async (req) => {
    const version = z.coerce.number().int().positive().parse((req.params as { version: string }).version);
    await activateWorkflowVersion(ctx, requireUser(req).id, sid(req.params), version);
    return { ok: true };
  });
  app.post("/admin/providers/:sourceId/workflows/:version/disable", admin, async (req) => {
    const version = z.coerce.number().int().positive().parse((req.params as { version: string }).version);
    await disableWorkflowVersion(ctx, requireUser(req).id, sid(req.params), version);
    return { ok: true };
  });
  app.post("/admin/providers/:sourceId/workflows/propose", admin, async (req) => {
    const { note } = parse(z.object({ note: z.string().max(1000).default("Layout changed") }), req.body);
    return proposeWorkflowFix(ctx, requireUser(req).id, sid(req.params), note);
  });
  app.post("/admin/health/evaluate", admin, async () => evaluateProviderHealth(ctx));

  app.get("/admin/failed-jobs", admin, async (req) => {
    const { all } = parse(z.object({ all: z.enum(["true", "false"]).optional() }), req.query);
    return { jobs: await listFailedJobs(ctx, all === "true") };
  });
  app.post("/admin/failed-jobs/:id/retry", admin, async (req) => {
    await retryFailedJob(ctx, requireUser(req).id, z.coerce.number().int().parse((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post("/admin/failed-jobs/:id/resolve", admin, async (req) => {
    await resolveFailedJob(ctx, requireUser(req).id, z.coerce.number().int().parse((req.params as { id: string }).id));
    return { ok: true };
  });

  app.get("/admin/abuse-reports", admin, async () => ({ reports: await listAbuseReports(ctx) }));
  app.patch("/admin/abuse-reports/:id", admin, async (req) => {
    const body = parse(
      z.object({
        status: z.enum(["OPEN", "INVESTIGATING", "ACTIONED", "DISMISSED"]),
        note: z.string().max(2000).optional(),
        suspendUser: z.boolean().optional(),
        clearProfileFlag: z.boolean().optional(),
      }),
      req.body,
    );
    await updateAbuseReport(ctx, requireUser(req).id, z.string().uuid().parse((req.params as { id: string }).id), body);
    return { ok: true };
  });

  app.get("/admin/audit", admin, async (req) => {
    const q = parse(z.object({ action: z.string().max(100).optional(), limit: z.coerce.number().int().optional() }), req.query);
    return { entries: await auditTrail(ctx, q) };
  });
}
