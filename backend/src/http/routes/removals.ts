import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MATCH_THRESHOLDS } from "../../../../core/matching";
import { badRequest } from "../../../../shared/errors";
import type { AppContext } from "../../context";
import { getOwnedRecord } from "../../services/records";
import { approveRequest, cancelRequest, getOwnedRequest, listRequests, planRemoval, requestPreview, respondToAction, retryRequest } from "../../services/removals";
import { idParam, parse, profileFor } from "../util";

export function registerRemovalRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Start a removal for an exposure (the user explicitly asks). */
  app.post("/removals", async (req, reply) => {
    const { user, profile } = await profileFor(ctx, req);
    const { recordId } = parse(z.object({ recordId: z.string().uuid() }), req.body);
    const r = await getOwnedRecord(ctx, profile.id, recordId);
    if (r.status === "DISMISSED") throw badRequest("You marked this exposure as not you.");
    if (r.match_confidence < MATCH_THRESHOLDS.WEAK) throw badRequest("This match is too weak to act on.");
    if (r.match_confidence < MATCH_THRESHOLDS.STRONG && r.user_confirmed !== true) {
      throw badRequest("Confirm this exposure is about you before requesting removal.");
    }
    const id = await planRemoval(ctx, r.id, { initiatedBy: user.id, force: true });
    if (!id) throw badRequest("No removal process is available for this exposure.");
    return reply.code(201).send({ request: await requestPreview(ctx, await getOwnedRequest(ctx, profile.id, id)) });
  });

  app.get("/removals", async (req) => {
    const { profile } = await profileFor(ctx, req);
    const { status } = parse(z.object({ status: z.string().max(300).optional(), profileId: z.string().optional() }), req.query);
    return { requests: await listRequests(ctx, profile.id, status) };
  });

  app.get("/removals/:id", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return { request: await requestPreview(ctx, await getOwnedRequest(ctx, profile.id, idParam(req))) };
  });

  app.get("/removals/:id/status", async (req) => {
    const { profile } = await profileFor(ctx, req);
    const r = await getOwnedRequest(ctx, profile.id, idParam(req));
    return { id: r.id, status: r.status, userAction: r.user_action, nextCheckAt: r.next_check_at, lastError: r.last_error, updatedAt: r.updated_at };
  });

  app.post("/removals/:id/approve", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const body = parse(z.object({ subject: z.string().max(200).optional(), body: z.string().max(5000).optional() }), req.body);
    await approveRequest(ctx, user.id, profile.id, idParam(req), body);
    return { ok: true };
  });

  app.post("/removals/:id/action", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const { choice } = parse(z.object({ choice: z.enum(["done", "skip", "continue_manually"]) }), req.body);
    await respondToAction(ctx, user.id, profile.id, idParam(req), choice);
    return { ok: true };
  });

  app.post("/removals/:id/retry", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    return { requestId: await retryRequest(ctx, user.id, profile.id, idParam(req)) };
  });

  app.post("/removals/:id/cancel", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    await cancelRequest(ctx, user.id, profile.id, idParam(req));
    return { ok: true };
  });
}
