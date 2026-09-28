import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OUTCOME_EXPLANATIONS, STATUS_EXPLANATIONS } from "../../../../ai/explain";
import { PLANS } from "../../../../core/abuse";
import { RATE_LIMITS } from "../../../../security/rate-limit";
import { verifyPassword } from "../../../../security/password";
import { ApprovalMode, PlanId } from "../../../../shared/domain";
import { AppError, badRequest, forbidden, tooManyRequests } from "../../../../shared/errors";
import type { AppContext } from "../../context";
import { deleteAccount, exportAccount } from "../../services/account";
import { audit } from "../../services/audit";
import { dashboard } from "../../services/dashboard";
import { receiveInboundEmail, verifyInboundSignature } from "../../services/inbox";
import { addRecordMonitor, deleteMonitor, ensureProfileRescan, listMonitoring } from "../../services/monitoring";
import { updateProfile } from "../../services/profiles";
import { reportCsv, reportPdf, reportSummary } from "../../services/reports";
import { scoreHistory } from "../../services/scoring";
import { allSources, sourceReliability } from "../../services/sources";
import { requireUser, SESSION_COOKIE } from "../app";
import { idParam, parse, profileFor, sendFile } from "../util";

const vals = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

export function registerMiscRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/dashboard", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return dashboard(ctx, profile.id);
  });

  app.get("/score/history", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return { history: await scoreHistory(ctx, profile.id) };
  });

  app.get("/explanations", { config: { auth: "public" } }, async () => ({ statuses: STATUS_EXPLANATIONS, outcomes: OUTCOME_EXPLANATIONS }));

  app.get("/jurisdictions", { config: { auth: "public" } }, async () => ({
    jurisdictions: await ctx.db.query("SELECT code, name, frameworks, available_rights, mechanisms, notes FROM jurisdictions ORDER BY name"),
  }));

  // ---- Monitoring ----
  app.get("/monitoring", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return {
      settings: { intervalDays: profile.monitoring_interval_days, enabled: profile.monitoring_enabled },
      jobs: await listMonitoring(ctx, profile.id),
    };
  });

  app.post("/monitoring", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const body = parse(
      z.object({ recordId: z.string().uuid().optional(), intervalDays: z.number().int().min(1).max(180).optional(), enabled: z.boolean().optional() }),
      req.body,
    );
    if (body.intervalDays !== undefined || body.enabled !== undefined) {
      await updateProfile(ctx, user, profile.id, { monitoringIntervalDays: body.intervalDays, monitoringEnabled: body.enabled });
      if (PLANS[user.plan].continuousMonitoring) await ensureProfileRescan(ctx, profile.id);
    }
    if (body.recordId) await addRecordMonitor(ctx, profile.id, body.recordId);
    return { ok: true };
  });

  app.delete("/monitoring/:id", async (req) => {
    const { profile } = await profileFor(ctx, req);
    await deleteMonitor(ctx, profile.id, idParam(req));
    return { ok: true };
  });

  // ---- Sources ----
  app.get("/sources", async (req) => {
    const { profile } = await profileFor(ctx, req);
    const rel = await sourceReliability(ctx);
    const prefs = await ctx.db.query<{ source_id: string; approval_mode: string }>("SELECT source_id, approval_mode FROM source_preferences WHERE profile_id = $1", [profile.id]);
    const found = await ctx.db.query<{ source_id: string; n: number }>(
      "SELECT source_id, count(*)::int AS n FROM discovered_records WHERE profile_id = $1 AND source_id IS NOT NULL AND NOT is_search_result GROUP BY source_id",
      [profile.id],
    );
    return {
      sources: (await allSources(ctx))
        .filter((s) => s.enabled)
        .map((s) => ({
          id: s.id,
          name: s.name,
          domain: s.domain,
          categories: s.categories,
          removalMethods: s.removalMethods,
          automationStatus: s.automationPaused ? "MANUAL_REVIEW" : s.automationStatus,
          automationPaused: s.automationPaused,
          requiresEmailVerification: s.requiresEmailVerification,
          requiresIdentityVerification: s.requiresIdentityVerification,
          estimatedRemovalDays: s.estimatedRemovalTime,
          reappearsFrequently: s.reappearsFrequently,
          optOutUrl: s.optOutUrl ?? null,
          notes: s.notes ?? null,
          lastVerifiedAt: s.lastVerifiedAt ?? null,
          reliability: rel.get(s.id) ?? { sufficientData: false, sampleSize: 0, successRate: null, averageRemovalDays: null, reappearance: null },
          approvalMode: prefs.find((p) => p.source_id === s.id)?.approval_mode ?? null,
          recordsFound: found.find((f) => f.source_id === s.id)?.n ?? 0,
        })),
    };
  });

  app.put("/sources/:sourceId/preference", async (req) => {
    const { user, profile } = await profileFor(ctx, req);
    const sourceId = (req.params as { sourceId: string }).sourceId;
    if (!/^[a-z0-9-]{2,64}$/.test(sourceId)) throw badRequest("Invalid source");
    const { approvalMode } = parse(z.object({ approvalMode: z.enum(vals(ApprovalMode)).nullable() }), req.body);
    if (approvalMode === "AUTOMATIC" && !PLANS[user.plan].automatedRemoval) throw forbidden("Automatic removal requires a paid plan.");
    if (approvalMode === null) await ctx.db.query("DELETE FROM source_preferences WHERE profile_id = $1 AND source_id = $2", [profile.id, sourceId]);
    else
      await ctx.db.query(
        "INSERT INTO source_preferences (profile_id, source_id, approval_mode) VALUES ($1, $2, $3) ON CONFLICT (profile_id, source_id) DO UPDATE SET approval_mode = EXCLUDED.approval_mode",
        [profile.id, sourceId, approvalMode],
      );
    await audit(ctx, { actorId: user.id, actorType: "user", action: "source_preference.updated", targetType: "data_source", targetId: sourceId, metadata: { approvalMode } });
    return { ok: true };
  });

  // ---- Reports ----
  app.get("/reports/summary", async (req) => {
    const { profile } = await profileFor(ctx, req);
    return reportSummary(ctx, profile.id);
  });
  app.get("/reports/export.csv", async (req, reply) => {
    const { profile } = await profileFor(ctx, req);
    return sendFile(reply, "text/csv; charset=utf-8", "privacy-report.csv", await reportCsv(ctx, profile.id));
  });
  app.get("/reports/export.pdf", async (req, reply) => {
    const { profile } = await profileFor(ctx, req);
    return sendFile(reply, "application/pdf", "privacy-report.pdf", await reportPdf(ctx, profile.id));
  });

  // ---- Notifications ----
  app.get("/notifications", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    return {
      notifications: await ctx.db.query(
        "SELECT id, kind, severity, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
        [user.id],
      ),
    };
  });
  app.post("/notifications/:id/read", async (req) => {
    await ctx.db.query("UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2", [idParam(req), requireUser(req).id]);
    return { ok: true };
  });
  app.post("/notifications/read-all", async (req) => {
    await ctx.db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [requireUser(req).id]);
    return { ok: true };
  });
  app.post("/push/subscribe", async (req) => {
    const user = requireUser(req);
    const sub = parse(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
    await ctx.db.query(
      "INSERT INTO push_subscriptions (user_id, endpoint_hash, subscription_ciphertext) VALUES ($1, $2, $3) ON CONFLICT (endpoint_hash) DO NOTHING",
      [user.id, ctx.cipher.blindIndex(sub.endpoint, "push"), ctx.cipher.encryptJson(sub, `push:${user.id}`)],
    );
    await ctx.db.query("UPDATE user_settings SET notify_push = true WHERE user_id = $1", [user.id]);
    return { ok: true, vapidPublicKey: ctx.cfg.VAPID_PUBLIC_KEY ?? null };
  });

  // ---- Settings ----
  app.get("/settings", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    return { settings: await ctx.db.one("SELECT notify_email, notify_push, notify_in_app, record_retention_days FROM user_settings WHERE user_id = $1", [user.id]) };
  });
  app.put("/settings", async (req) => {
    const user = requireUser(req);
    const s = parse(
      z.object({
        notifyEmail: z.boolean().optional(),
        notifyPush: z.boolean().optional(),
        notifyInApp: z.boolean().optional(),
        recordRetentionDays: z.number().int().min(30).max(3650).optional(),
      }),
      req.body,
    );
    await ctx.db.query(
      `UPDATE user_settings SET notify_email = COALESCE($2, notify_email), notify_push = COALESCE($3, notify_push),
         notify_in_app = COALESCE($4, notify_in_app), record_retention_days = COALESCE($5, record_retention_days), updated_at = now()
       WHERE user_id = $1`,
      [user.id, s.notifyEmail ?? null, s.notifyPush ?? null, s.notifyInApp ?? null, s.recordRetentionDays ?? null],
    );
    await audit(ctx, { actorId: user.id, actorType: "user", action: "settings.updated", metadata: { fields: Object.keys(s) } });
    return { ok: true };
  });

  // ---- Account (export / permanent deletion) ----
  app.get("/account/export", async (req, reply) => {
    const user = requireUser(req);
    const rl = await ctx.rateLimiter.hit(`export:${user.id}`, RATE_LIMITS.exportPerDay.limit, RATE_LIMITS.exportPerDay.windowSec);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    return sendFile(reply, "application/json", "deep-scrubber-export.json", JSON.stringify(await exportAccount(ctx, user.id), null, 2));
  });
  app.delete("/account", { config: { allowUnverified: true } }, async (req, reply) => {
    const user = requireUser(req);
    const { password, confirm } = parse(z.object({ password: z.string().max(256), confirm: z.literal("DELETE") }), req.body);
    const row = await ctx.db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new AppError("UNAUTHORIZED", "Password is incorrect.", 401);
    void confirm;
    await deleteAccount(ctx, user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/", domain: ctx.cfg.COOKIE_DOMAIN });
    return { ok: true };
  });

  // ---- Billing (subscription architecture; payments are out of scope) ----
  app.get("/billing/plans", { config: { auth: "public" } }, async () => ({
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, priceMonthlyUsd: p.priceMonthlyUsd, summary: p.summary, maxProfiles: p.maxProfiles })),
    disclaimer: "No service can guarantee removal of information from the internet.",
  }));
  app.post("/billing/change-plan", async (req) => {
    const user = requireUser(req);
    const { plan } = parse(z.object({ plan: z.enum(vals(PlanId)) }), req.body);
    if (ctx.cfg.BILLING_MODE !== "dev") {
      throw new AppError("BILLING_UNAVAILABLE", "Plan changes are handled by the billing provider, which is not configured.", 501);
    }
    if (plan === "BUSINESS") throw forbidden("Business plans require a signed authorization agreement. Contact sales.");
    await ctx.db.query("UPDATE users SET plan = $2 WHERE id = $1", [user.id, plan]);
    await audit(ctx, { actorId: user.id, actorType: "user", action: "billing.plan_changed", metadata: { plan } });
    return { ok: true };
  });

  // ---- Abuse reports (public) ----
  app.post("/abuse-reports", { config: { auth: "public" } }, async (req, reply) => {
    const rl = await ctx.rateLimiter.hit(`abuse:${req.ip}`, RATE_LIMITS.abuseReportPerIp.limit, RATE_LIMITS.abuseReportPerIp.windowSec);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    const body = parse(
      z.object({
        category: z.enum(["TARGETING_OTHERS", "IMPERSONATION", "FRAUDULENT_REQUEST", "OTHER"]),
        description: z.string().min(20).max(4000),
        contact: z.string().max(320).optional(),
      }),
      req.body,
    );
    await ctx.db.query("INSERT INTO abuse_reports (reporter_contact_ciphertext, category, description, source) VALUES ($1, $2, $3, 'external')", [
      body.contact ? ctx.cipher.encrypt(body.contact, "abuse-contact") : null,
      body.category,
      body.description,
    ]);
    return reply.code(202).send({ ok: true });
  });

  // ---- Inbound mail webhook for relay aliases (signed; no session) ----
  app.post("/inbound-email", { config: { auth: "public", csrf: false } }, async (req, reply) => {
    verifyInboundSignature(ctx.cfg.INBOUND_EMAIL_SECRET, req.rawBody ?? "", req.headers["x-signature"] as string | undefined);
    const msg = parse(z.object({ to: z.string().max(320), from: z.string().max(320), subject: z.string().max(1000), text: z.string().max(200_000) }), req.body);
    const accepted = await receiveInboundEmail(ctx, msg);
    return reply.code(accepted ? 202 : 204).send();
  });
}
