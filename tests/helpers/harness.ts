import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createContext, type AppContext } from "../../backend/src/context";
import { buildApp } from "../../backend/src/http/app";
import { SafeHttpClient } from "../../backend/src/infra/http-client";
import { LogMailer } from "../../backend/src/infra/mailer";
import { MemoryJobQueue } from "../../backend/src/infra/queue";
import { seedRegistry } from "../../backend/src/services/sources";
import { Database } from "../../database/db";
import { migrate } from "../../database/migrator";
import { FixtureSearchProvider } from "../../providers/search/fixture";
import { startMockBroker, type MockBroker, type MockBrokerOptions } from "../../removal-agents/example-broker/mock-server";
import { MemoryRateLimiter } from "../../security/rate-limit";
import { defaultFetchPolicy, UnsafeUrlError, type SafeFetchInit } from "../../security/ssrf";
import { loadConfig } from "../../shared/config";
import { createJobHandler } from "../../workers/src/handlers";
import { resetCipherForTests } from "../../security/crypto";

/** Blocks everything except the local mock broker so tests stay hermetic. */
class OfflineHttpClient extends SafeHttpClient {
  override request(url: string, init?: SafeFetchInit) {
    if (new URL(url).hostname !== "127.0.0.1") return Promise.reject(new UnsafeUrlError("offline test environment"));
    return super.request(url, init);
  }
  override scoped(): SafeHttpClient {
    return new OfflineHttpClient({ ...defaultFetchPolicy, privateHostAllowlist: ["127.0.0.1"] });
  }
}

export interface Harness {
  ctx: AppContext;
  app: FastifyInstance;
  broker: MockBroker;
  queue: MemoryJobQueue;
  search: FixtureSearchProvider;
  mailer: LogMailer;
  clock: { t: number; now(): Date; advanceDays(d: number): void };
  drain(): Promise<number>;
  close(): Promise<void>;
}

export async function resetDatabase(url: string) {
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`Refusing to reset non-test database ${new URL(url).pathname}`);
  const db = new Database(url, 1);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  await db.close();
}

export async function createHarness(brokerOpts: MockBrokerOptions = {}): Promise<Harness> {
  resetCipherForTests();
  const url = process.env.DATABASE_URL!;
  await resetDatabase(url);
  const clock = {
    t: Date.now(),
    now() {
      return new Date(this.t);
    },
    advanceDays(d: number) {
      this.t += d * 86_400_000;
    },
  };
  let appRef: FastifyInstance | undefined;
  const broker = await startMockBroker({
    requireEmailVerification: true,
    ...brokerOpts,
    // Deliver broker emails to the relay webhook, as an inbound-mail provider would.
    onEmail: async (mail) => {
      if (!appRef || !mail.to.endsWith("@relay.test")) return;
      const payload = JSON.stringify({ to: mail.to, from: "no-reply@127.0.0.1", subject: mail.subject, text: mail.body });
      await appRef.inject({
        method: "POST",
        url: "/api/inbound-email",
        headers: { "content-type": "application/json", "x-signature": createHmac("sha256", "test-inbound-secret").update(payload).digest("hex") },
        payload,
      });
    },
  });
  const cfg = { ...loadConfig(process.env), EXAMPLE_BROKER_BASE_URL: broker.url };
  const search = new FixtureSearchProvider(
    [
      {
        match: "john example",
        results: [
          { url: `${broker.url}/profile/p-1001`, title: "John Example, 41 - Boca Raton, FL | ExampleBroker", snippet: "John Example, Age 41, Boca Raton, FL. Phone (555) 555-1234." },
          { url: "https://examplemirror.test/people/john-example-boca-raton-fl", title: "John Example - Boca Raton, FL | ExampleMirror", snippet: "John Example, age 41, Boca Raton, FL. Phone (555) 555-1234. Address 123 Palm Tree Ave. Possible relatives: Jane Example." },
          { url: "https://exampledirectory.test/listing/john-example", title: "John Example - directory listing", snippet: "Directory listing for John Example in Boca Raton, FL. Contact john@example.com." },
          { url: "https://github.com/jexample", title: "jexample (John Example) · GitHub", snippet: "John Example jexample. Boca Raton, FL." },
          { url: "https://citynews.example/2019/local-5k", title: "Local 5K results | City News", snippet: "Runners including John Example of Boca Raton, FL finished the race, according to organizers." },
          { url: "https://people.example/other", title: "John Example - Portland, OR", snippet: "John Example, 67, Portland, OR" },
        ],
      },
    ],
    "fixture",
    "Fixture Search",
  );
  const queue = new MemoryJobQueue(() => clock.t);
  const mailer = new LogMailer();
  const ctx = createContext({
    cfg,
    clock,
    queue,
    mailer,
    rateLimiter: new MemoryRateLimiter(),
    searchProviders: [search],
    http: new OfflineHttpClient({ ...defaultFetchPolicy, privateHostAllowlist: ["127.0.0.1"] }),
  });
  await seedRegistry(ctx);
  const handler = createJobHandler(ctx);
  queue.handler = (name, data) => handler(name, data);
  const app = await buildApp(ctx);
  appRef = app;
  return {
    ctx,
    app,
    broker,
    queue,
    search,
    mailer,
    clock,
    drain: () => queue.drain(clock.t),
    async close() {
      await app.close();
      await broker.close();
      await ctx.db.close();
    },
  };
}

/** A logged-in API client (cookie + CSRF), driven through fastify.inject. */
export class Client {
  cookie = "";
  csrf = "";
  constructor(private readonly app: FastifyInstance) {}

  async req<T = any>(method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<{ status: number; json: T; raw: string; headers: Record<string, unknown> }> {
    const res = await this.app.inject({
      method: method as never,
      url,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(opts.csrf !== false && this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers["set-cookie"];
    const c = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (c?.startsWith("ds_session=")) this.cookie = c.split(";")[0]!;
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* non-JSON */
    }
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: res.statusCode, json, raw: res.body, headers: res.headers };
  }
  get = <T = any>(url: string) => this.req<T>("GET", url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>("POST", url, body);
  patch = <T = any>(url: string, body: unknown) => this.req<T>("PATCH", url, body);
  put = <T = any>(url: string, body: unknown) => this.req<T>("PUT", url, body);
  del = <T = any>(url: string, body?: unknown) => this.req<T>("DELETE", url, body);
}

export async function signupVerified(h: Harness, email: string, plan: "FREE" | "PRO" | "FAMILY" = "FREE"): Promise<Client> {
  const c = new Client(h.app);
  const s = await c.post("/api/auth/signup", { email, password: "a-very-long-password-123", acceptTerms: true });
  if (s.status !== 201) throw new Error(`signup failed: ${s.raw}`);
  const mail = h.mailer.sent.filter((m) => m.to === email).pop()!;
  const token = /token=([\w-]+)/.exec(mail.text)![1];
  const v = await c.post("/api/auth/verify-email", { token });
  if (v.status !== 200) throw new Error(`verify failed: ${v.raw}`);
  await c.get("/api/auth/me");
  if (plan !== "FREE") {
    const p = await c.post("/api/billing/change-plan", { plan });
    if (p.status !== 200) throw new Error(`plan failed: ${p.raw}`);
    // Session caches plan per request via authenticate(); nothing else to refresh.
  }
  return c;
}

export async function createJohnProfile(c: Client, opts: { approvalMode?: string } = {}) {
  const p = await c.post("/api/profile", {
    label: "Me",
    relationship: "SELF",
    authorizationStatement: "I am John Example and I am requesting removal of my own information.",
    attest: true,
    jurisdictionCode: "US-FL",
    defaultApprovalMode: opts.approvalMode,
  });
  if (p.status !== 201) throw new Error(`profile failed: ${p.raw}`);
  const id = p.json.profile.id as string;
  for (const [type, value] of [
    ["FULL_NAME", "John Example"],
    ["EMAIL", "john@example.com"],
    ["PHONE", "(555) 555-1234"],
    ["USERNAME", "jexample"],
    ["LOCATION", "Boca Raton, FL"],
  ]) {
    const r = await c.post(`/api/profile/${id}/identifiers`, { type, value });
    if (r.status !== 201) throw new Error(`identifier failed: ${r.raw}`);
  }
  return id;
}
