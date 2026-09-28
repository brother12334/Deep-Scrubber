import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RATE_LIMITS } from "../../../../security/rate-limit";
import { tooManyRequests } from "../../../../shared/errors";
import type { AppContext } from "../../context";
import { issueEmailToken, login, logout, setupMfa, signup, verifyEmail, verifyMfa, getUserEmail } from "../../services/users";
import { requireUser, SESSION_COOKIE } from "../app";
import { parse } from "../util";

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookieOpts = () => ({
    httpOnly: true,
    secure: ctx.cfg.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    domain: ctx.cfg.COOKIE_DOMAIN,
    maxAge: ctx.cfg.SESSION_TTL_HOURS * 3600,
  });

  app.post("/auth/signup", { config: { auth: "public" } }, async (req, reply) => {
    const rl = await ctx.rateLimiter.hit(`signup:${req.ip}`, RATE_LIMITS.authSignup.limit, RATE_LIMITS.authSignup.windowSec);
    if (!rl.allowed) throw tooManyRequests("Too many sign-up attempts. Try again later.", rl.retryAfterSec);
    const body = parse(z.object({ email: z.string().max(320), password: z.string().max(256), acceptTerms: z.boolean() }), req.body);
    await signup(ctx, body, req.ip);
    const session = await login(ctx, body, req.ip);
    reply.setCookie(SESSION_COOKIE, session.token, cookieOpts());
    return reply.code(201).send({ user: publicUser(session.user, ctx.cfg.REQUIRE_EMAIL_VERIFICATION), csrfToken: session.user.csrfToken });
  });

  app.post("/auth/login", { config: { auth: "public" } }, async (req, reply) => {
    const rl = await ctx.rateLimiter.hit(`login:${req.ip}`, RATE_LIMITS.authLogin.limit, RATE_LIMITS.authLogin.windowSec);
    if (!rl.allowed) throw tooManyRequests("Too many login attempts. Try again later.", rl.retryAfterSec);
    const body = parse(z.object({ email: z.string().max(320), password: z.string().max(256) }), req.body);
    const session = await login(ctx, body, req.ip);
    reply.setCookie(SESSION_COOKIE, session.token, cookieOpts());
    return { user: publicUser(session.user, ctx.cfg.REQUIRE_EMAIL_VERIFICATION), csrfToken: session.user.csrfToken };
  });

  app.post("/auth/logout", { config: { allowUnverified: true } }, async (req, reply) => {
    await logout(ctx, requireUser(req).sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/", domain: ctx.cfg.COOKIE_DOMAIN });
    return { ok: true };
  });

  app.get("/auth/me", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    return { user: publicUser(user, ctx.cfg.REQUIRE_EMAIL_VERIFICATION), csrfToken: user.csrfToken };
  });

  app.post("/auth/verify-email", { config: { auth: "public" } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    await verifyEmail(ctx, token);
    return { ok: true };
  });

  app.post("/auth/resend-verification", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    const rl = await ctx.rateLimiter.hit(`resend:${user.id}`, 3, 3600);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    if (user.emailVerified) return { ok: true };
    const token = await issueEmailToken(ctx, user.id, "verify_email");
    await ctx.mailer.send({
      to: await getUserEmail(ctx, user.id),
      subject: "Verify your Deep Scrubber account",
      text: `${ctx.cfg.PUBLIC_APP_URL}/verify-email?token=${token}`,
    });
    return { ok: true };
  });

  app.post("/auth/mfa/setup", { config: { allowUnverified: true } }, async (req) => setupMfa(ctx, requireUser(req).id));

  app.post("/auth/mfa/verify", { config: { allowUnverified: true } }, async (req) => {
    const user = requireUser(req);
    const rl = await ctx.rateLimiter.hit(`mfa:${user.id}`, 10, 900);
    if (!rl.allowed) throw tooManyRequests(undefined, rl.retryAfterSec);
    const { code, enable } = parse(z.object({ code: z.string().regex(/^\d{6}$/), enable: z.boolean().default(false) }), req.body);
    await verifyMfa(ctx, user, code, enable || !user.mfaEnabled);
    return { ok: true };
  });
}

function publicUser(u: { id: string; role: string; plan: string; emailVerified: boolean; mfaEnabled: boolean; mfaVerified: boolean }, requireVerification: boolean) {
  return {
    id: u.id,
    role: u.role,
    plan: u.plan,
    emailVerified: u.emailVerified,
    mustVerifyEmail: requireVerification && !u.emailVerified,
    mfaEnabled: u.mfaEnabled,
    mfaVerified: u.mfaVerified,
  };
}
