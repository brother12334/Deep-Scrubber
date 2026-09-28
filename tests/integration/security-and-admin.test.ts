import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateProviderHealth } from "../../backend/src/services/health";
import { planRemoval } from "../../backend/src/services/removals";
import { totpAt } from "../../security/totp";
import { Client, createHarness, createJohnProfile, signupVerified, type Harness } from "../helpers/harness";

describe("authorization, CSRF and tenant isolation", () => {
  let h: Harness;
  let alice: Client;
  let mallory: Client;

  beforeAll(async () => {
    h = await createHarness();
    alice = await signupVerified(h, "john@example.com", "PRO");
    await createJohnProfile(alice);
    await alice.post("/api/scans");
    await h.drain();
    mallory = await signupVerified(h, "mallory@example.org", "PRO");
  });
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("requires authentication", async () => {
    const anon = new Client(h.app);
    expect((await anon.get("/api/exposures")).status).toBe(401);
    expect((await anon.get("/api/admin/metrics")).status).toBe(401);
  });

  it("rejects state changes without the CSRF token", async () => {
    const r = await alice.req("POST", "/api/scans", {}, { csrf: false });
    expect(r.status).toBe(403);
  });

  it("isolates tenants: another user cannot see or act on exposures", async () => {
    const ex = (await alice.get("/api/exposures")).json.items[0];
    expect((await mallory.get(`/api/exposures/${ex.id}`)).status).toBe(404); // mallory has no profile
    await mallory.post("/api/profile", { label: "Me", relationship: "SELF", authorizationStatement: "This is my own information.", attest: true });
    expect((await mallory.get(`/api/exposures/${ex.id}`)).status).toBe(404);
    expect((await mallory.post(`/api/exposures/${ex.id}/dismiss`)).status).toBe(404);
    const reqs = (await alice.get("/api/removals")).json.requests;
    expect((await mallory.post(`/api/removals/${reqs[0].id}/approve`)).status).toBe(404);
  });

  it("masks sensitive identifiers and audits explicit reveals", async () => {
    const p = (await alice.get("/api/profile")).json.profiles[0];
    const phone = p.identifiers.find((i: any) => i.type === "PHONE");
    expect(phone.displayValue).toBe("••••••••34");
    const name = p.identifiers.find((i: any) => i.type === "FULL_NAME");
    expect(name.displayValue).toBe("John Example");
    const rev = await alice.post(`/api/profile/${p.id}/identifiers/${phone.id}/reveal`);
    expect(rev.json.value).toBe("(555) 555-1234");
    const audit = await h.ctx.db.one("SELECT 1 FROM audit_logs WHERE action = 'identifier.revealed'");
    expect(audit).toBeTruthy();
    expect((await alice.del(`/api/profile/${p.id}/identifiers/${phone.id}`)).status).toBe(200);
  });

  it("requires a verified email before scanning", async () => {
    const c = new Client(h.app);
    await c.post("/api/auth/signup", { email: "new@example.net", password: "a-very-long-password-123", acceptTerms: true });
    const r = await c.post("/api/profile", { label: "Me", relationship: "SELF", authorizationStatement: "This is my own information.", attest: true });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("requires authorization attestation and plan eligibility for profiles", async () => {
    const c = await signupVerified(h, "free@example.net", "FREE");
    const noAttest = await c.post("/api/profile", { label: "Me", relationship: "SELF", authorizationStatement: "This is my own information.", attest: false });
    expect(noAttest.status).toBe(400);
    const family = await c.post("/api/profile", { label: "Mom", relationship: "FAMILY_MEMBER", authorizationStatement: "My mother asked me to help.", attest: true });
    expect(family.status).toBe(403);
  });

  it("rejects unsigned inbound email", async () => {
    const anon = new Client(h.app);
    const r = await anon.req("POST", "/api/inbound-email", { to: "x@relay.test", from: "a@b.c", subject: "s", text: "t" });
    expect(r.status).toBe(401);
    const payload = JSON.stringify({ to: "unknown@relay.test", from: "a@b.c", subject: "s", text: "t" });
    const signed = await h.app.inject({
      method: "POST",
      url: "/api/inbound-email",
      headers: { "content-type": "application/json", "x-signature": createHmac("sha256", "test-inbound-secret").update(payload).digest("hex") },
      payload,
    });
    expect(signed.statusCode).toBe(204);
  });
});

describe("abuse prevention", () => {
  let h: Harness;
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("flags profiles that target several unrelated people and blocks submissions", async () => {
    h = await createHarness();
    const c = await signupVerified(h, "abuser@example.org", "FAMILY");
    const p = await c.post("/api/profile", { label: "Targets", relationship: "SELF", authorizationStatement: "These are all me, honestly.", attest: true });
    const pid = p.json.profile.id;
    for (const n of ["Alice Anders", "Bob Brown", "Carol Chen", "Dan Diaz", "Eve Evans"]) {
      await c.post(`/api/profile/${pid}/identifiers`, { type: "FULL_NAME", value: n });
    }
    const profile = (await c.get("/api/profile")).json.profiles[0];
    expect(profile.underReview).toBe(true);
    const report = await h.ctx.db.one<{ category: string; source: string }>("SELECT category, source FROM abuse_reports");
    expect(report).toMatchObject({ category: "MANY_UNRELATED_NAMES", source: "automated" });
  });

  it("flags identifiers already claimed by another account", async () => {
    const a = await signupVerified(h, "a@example.org", "PRO");
    const b = await signupVerified(h, "b@example.org", "PRO");
    const pa = (await a.post("/api/profile", { label: "Me", relationship: "SELF", authorizationStatement: "This is my own information.", attest: true })).json.profile.id;
    const pb = (await b.post("/api/profile", { label: "Me", relationship: "SELF", authorizationStatement: "This is my own information.", attest: true })).json.profile.id;
    await a.post(`/api/profile/${pa}/identifiers`, { type: "PHONE", value: "(555) 123-9999" });
    await b.post(`/api/profile/${pb}/identifiers`, { type: "PHONE", value: "555.123.9999" });
    expect((await b.get("/api/profile")).json.profiles[0].underReview).toBe(true);
  });
});

describe("admin: MFA, PII-free views, provider circuit breaker", () => {
  let h: Harness;
  let admin: Client;
  let user: Client;

  beforeAll(async () => {
    h = await createHarness();
    user = await signupVerified(h, "john@example.com", "PRO");
    await createJohnProfile(user, { approvalMode: "APPROVAL_REQUIRED" });
    await user.post("/api/scans");
    await h.drain();
    admin = await signupVerified(h, "admin@deepscrubber.test", "FREE");
    await h.ctx.db.query("UPDATE users SET role = 'admin' WHERE email_hash = (SELECT email_hash FROM users ORDER BY created_at DESC LIMIT 1)");
  });
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("denies normal users and requires MFA for admins", async () => {
    expect((await user.get("/api/admin/metrics")).status).toBe(403);
    const noMfa = await admin.get("/api/admin/metrics");
    expect(noMfa.status).toBe(403);
    expect(noMfa.json.error.code).toBe("MFA_REQUIRED");
    const setup = await admin.post("/api/auth/mfa/setup");
    const code = totpAt(setup.json.secret, h.clock.now().getTime());
    expect((await admin.post("/api/auth/mfa/verify", { code, enable: true })).status).toBe(200);
    expect((await admin.get("/api/admin/metrics")).status).toBe(200);
  });

  it("admin views never contain personal data", async () => {
    const dump = JSON.stringify([
      (await admin.get("/api/admin/metrics")).json,
      (await admin.get("/api/admin/providers")).json,
      (await admin.get("/api/admin/audit?limit=500")).json,
      (await admin.get("/api/admin/failed-jobs?all=true")).json,
    ]);
    for (const s of ["john@example.com", "John Example", "555-1234", "p-1001", "Boca"]) expect(dump).not.toContain(s);
  });

  it("auto-pauses a failing provider and stops automated submissions", async () => {
    for (let i = 0; i < 6; i++) await h.ctx.db.query("INSERT INTO provider_health_events (source_id, kind) VALUES ('example-broker', 'RUN_FAILED')");
    for (let i = 0; i < 4; i++) await h.ctx.db.query("INSERT INTO provider_health_events (source_id, kind) VALUES ('example-broker', 'RUN_SUCCEEDED')");
    const res = await evaluateProviderHealth(h.ctx);
    expect(res.paused).toContain("example-broker");
    const providers = (await admin.get("/api/admin/providers")).json.providers;
    expect(providers.find((p: any) => p.id === "example-broker").automationPaused).toBe(true);
    const notes = (await admin.get("/api/notifications")).json.notifications;
    expect(notes.some((n: any) => n.kind === "PROVIDER_WARNING")).toBe(true);

    // A new plan for a broker record now falls back to manual.
    const rec = await h.ctx.db.one<{ id: string }>("SELECT id FROM discovered_records WHERE source_id = 'example-broker' AND NOT is_search_result");
    await h.ctx.db.query("UPDATE removal_requests SET status = 'CANCELLED' WHERE record_id = $1", [rec!.id]);
    const reqId = await planRemoval(h.ctx, rec!.id, { force: true });
    const r = await h.ctx.db.one<{ status: string }>("SELECT status FROM removal_requests WHERE id = $1", [reqId]);
    expect(r!.status).toBe("REQUIRES_USER_ACTION");

    expect((await admin.post("/api/admin/providers/example-broker/pause", { paused: false })).status).toBe(200);
  });

  it("manages versioned workflows", async () => {
    const versions = (await admin.get("/api/admin/providers/example-broker/workflows")).json.versions;
    expect(versions[0]).toMatchObject({ version: 1, status: "ACTIVE" });
    const def = { ...versions[0].definition, description: "v2 tweak" };
    const bad = await admin.post("/api/admin/providers/example-broker/workflows", { definition: { ...def, steps: [] }, changelog: "broken" });
    expect(bad.status).toBe(400);
    const created = await admin.post("/api/admin/providers/example-broker/workflows", { definition: def, changelog: "Update copy" });
    expect(created.json.version).toBe(2);
    expect((await admin.post("/api/admin/providers/example-broker/workflows/2/activate")).status).toBe(200);
    const after = (await admin.get("/api/admin/providers/example-broker/workflows")).json.versions;
    expect(after.find((v: any) => v.version === 2).status).toBe("ACTIVE");
    expect(after.find((v: any) => v.version === 1).status).toBe("RETIRED");
  });
});
