import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { RATE_LIMITS } from "../../../security/rate-limit";
import { AppError, forbidden, tooManyRequests, unauthorized } from "../../../shared/errors";
import type { AppContext } from "../context";
import { authenticate, type SessionUser } from "../services/users";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerExposureRoutes } from "./routes/exposures";
import { registerMiscRoutes } from "./routes/misc";
import { registerProfileRoutes } from "./routes/profile";
import { registerRemovalRoutes } from "./routes/removals";

export const SESSION_COOKIE = "ds_session";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
    rawBody?: string;
  }
  interface FastifyContextConfig {
    /** "public" skips authentication; "admin" requires the admin role (+MFA when configured). */
    auth?: "public" | "user" | "admin";
    /** Skip CSRF for endpoints authenticated by other means (signed webhooks). */
    csrf?: boolean;
    /** Allow users whose email is not verified yet. */
    allowUnverified?: boolean;
  }
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: ctx.cfg.TRUST_PROXY,
    bodyLimit: 1_000_000,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cookie);

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = body as string;
    (req as FastifyRequest).rawBody = raw;
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError("BAD_JSON", "Malformed JSON body", 400), undefined);
    }
  });

  const origins = new Set(ctx.cfg.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean));
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
      if (req.method === "OPTIONS") {
        reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE");
        reply.header("access-control-allow-headers", "content-type,x-csrf-token");
        reply.header("access-control-max-age", "600");
        return reply.code(204).send();
      }
    }
    reply.header("cache-control", "no-store");
    // Per-IP rate limit on everything.
    const rl = await ctx.rateLimiter.hit(`ip:${req.ip}`, RATE_LIMITS.apiPerIp.limit, RATE_LIMITS.apiPerIp.windowSec);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
  });

  // Authentication, authorization, CSRF and per-user rate limiting.
  app.addHook("preHandler", async (req) => {
    const cfg = req.routeOptions.config;
    const mode = cfg.auth ?? "user";
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = (await authenticate(ctx, token)) ?? undefined;
    if (mode === "public") return;
    if (!req.user) throw unauthorized();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && cfg.csrf !== false) {
      if (req.headers["x-csrf-token"] !== req.user.csrfToken) throw forbidden("Missing or invalid CSRF token.");
    }
    if (mode === "admin") {
      if (req.user.role !== "admin") throw forbidden();
      if (ctx.cfg.ADMIN_REQUIRE_MFA && !req.user.mfaVerified) throw new AppError("MFA_REQUIRED", "Administrator MFA required.", 403);
    }
    if (ctx.cfg.REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified && !cfg.allowUnverified && mode !== "admin") {
      // Reads are fine; state changes need a verified email (account verification, spec §29).
      if (req.method !== "GET") throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email address first.", 403);
    }
    const rl = await ctx.rateLimiter.hit(`user:${req.user.id}`, RATE_LIMITS.apiPerUser.limit, RATE_LIMITS.apiPerUser.windowSec);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
  });

  app.setErrorHandler((err, req, reply: FastifyReply) => {
    if (err instanceof AppError) {
      if (err.status === 429 && err.details?.retryAfterSec) reply.header("retry-after", String(err.details.retryAfterSec));
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid request", details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    ctx.log.error({ reqId: req.id, url: req.routeOptions.url, err: (err as Error).message, stack: (err as Error).stack }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } }));

  app.get("/healthz", { config: { auth: "public" } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { auth: "public" } }, async () => {
    await ctx.db.query("SELECT 1");
    return { ok: true };
  });

  await app.register(
    async (api) => {
      registerAuthRoutes(api, ctx);
      registerProfileRoutes(api, ctx);
      registerExposureRoutes(api, ctx);
      registerRemovalRoutes(api, ctx);
      registerMiscRoutes(api, ctx);
      registerAdminRoutes(api, ctx);
    },
    { prefix: "/api" },
  );
  return app;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
