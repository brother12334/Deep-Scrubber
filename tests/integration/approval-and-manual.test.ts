import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createJohnProfile, signupVerified, type Client, type Harness } from "../helpers/harness";

describe("approval-required mode (Pro) with user email verification", () => {
  let h: Harness;
  let c: Client;

  beforeAll(async () => {
    h = await createHarness();
    c = await signupVerified(h, "john@example.com", "PRO");
    await createJohnProfile(c, { approvalMode: "APPROVAL_REQUIRED" });
    await c.post("/api/scans");
    await h.drain();
  });
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("prepares a request and waits for approval — nothing is submitted yet", async () => {
    const reqs = await c.get("/api/removals?status=AWAITING_APPROVAL");
    const r = reqs.json.requests.find((x: any) => x.sourceName === "ExampleBroker");
    expect(r).toBeTruthy();
    expect(h.broker.requests.length).toBe(0);
    const preview = await c.get(`/api/removals/${r.id}`);
    expect(preview.json.request).toMatchObject({ recipient: "ExampleBroker", pathway: { pathway: "DATA_BROKER_OPT_OUT", confidence: "HIGH" } });
    expect(preview.json.request.body).toMatch(/requesting the removal of my personal information/);
  });

  it("approve (with edit) → submit → pause for email verification → user confirms → resume", async () => {
    const r = (await c.get("/api/removals?status=AWAITING_APPROVAL")).json.requests.find((x: any) => x.sourceName === "ExampleBroker");
    const tooShort = await c.post(`/api/removals/${r.id}/approve`, { body: "short" });
    expect(tooShort.status).toBe(400);
    const edited = `Hello, please remove my listing. ${"Thank you. ".repeat(3)}`;
    expect((await c.post(`/api/removals/${r.id}/approve`, { body: edited })).status).toBe(200);
    await h.drain();

    let st = await c.get(`/api/removals/${r.id}/status`);
    expect(st.json.status).toBe("REQUIRES_USER_ACTION");
    expect(st.json.userAction.kind).toBe("EMAIL_VERIFICATION");
    expect(h.broker.requests.length).toBe(1);

    // The user clicks the link in their own inbox.
    const link = /(http\S+verify\?token=\S+)/.exec(h.broker.outbox[0]!.body)![1]!;
    await fetch(link);
    expect((await c.post(`/api/removals/${r.id}/action`, { choice: "done" })).status).toBe(200);
    await h.drain();
    st = await c.get(`/api/removals/${r.id}/status`);
    expect(st.json.status).toBe("AWAITING_VERIFICATION");

    const dash = await c.get("/api/dashboard");
    expect(dash.json.cards.activeRemovals).toBeGreaterThanOrEqual(1);
  });

  it("per-source preference can force manual mode", async () => {
    expect((await c.put("/api/sources/example-directory/preference", { approvalMode: "MANUAL" })).status).toBe(200);
    const src = await c.get("/api/sources");
    expect(src.json.sources.find((s: any) => s.id === "example-directory").approvalMode).toBe("MANUAL");
    // Reliability is never fabricated: too few samples → no success rate.
    expect(src.json.sources.find((s: any) => s.id === "example-broker").reliability.successRate).toBeNull();
  });
});

describe("free plan: guided manual removal only", () => {
  let h: Harness;
  let c: Client;

  beforeAll(async () => {
    h = await createHarness({ requireEmailVerification: false });
    c = await signupVerified(h, "john@example.com", "FREE");
    await createJohnProfile(c);
    await c.post("/api/scans");
    await h.drain();
  });
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("never automates, gives instructions, and verifies after the user acts", async () => {
    const reqs = await c.get("/api/removals");
    const r = reqs.json.requests.find((x: any) => x.sourceName === "ExampleBroker");
    expect(r.status).toBe("REQUIRES_USER_ACTION");
    expect(r.userAction.instructions.length).toBeGreaterThan(0);
    expect(h.broker.requests.length).toBe(0);

    const auto = await c.patch(`/api/profile/${(await c.get("/api/profile")).json.profiles[0].id}`, { defaultApprovalMode: "AUTOMATIC" });
    expect(auto.status).toBe(403);

    // User completes the opt-out themselves; we verify.
    h.broker.people.get("p-1001")!.removed = true;
    await c.post(`/api/removals/${r.id}/action`, { choice: "done" });
    h.clock.advanceDays(3.5);
    await h.drain();
    const ex = await c.get(`/api/exposures/${r.recordId}`);
    expect(ex.json.exposure.status).toBe("REMOVED");
    expect(ex.json.exposure.removalOutcome).toBe("REMOVED_FROM_SOURCE");
  });

  it("enforces the free plan's scan quota", async () => {
    const again = await c.post("/api/scans");
    expect(again.status).toBe(429);
  });
});

describe("human verification (CAPTCHA) pauses automation", () => {
  let h: Harness;
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("offers to continue manually and never submits", async () => {
    h = await createHarness({ captcha: true });
    const c = await signupVerified(h, "john@example.com", "PRO");
    const pid = await createJohnProfile(c);
    await c.patch(`/api/profile/${pid}`, { defaultApprovalMode: "AUTOMATIC", blanketAuthorization: true });
    await c.post("/api/scans");
    await h.drain();
    const r = (await c.get("/api/removals")).json.requests.find((x: any) => x.sourceName === "ExampleBroker");
    expect(r.status).toBe("REQUIRES_USER_ACTION");
    expect(r.userAction.kind).toBe("HUMAN_VERIFICATION");
    expect(h.broker.requests.length).toBe(0);
    await c.post(`/api/removals/${r.id}/action`, { choice: "continue_manually" });
    const st = await c.get(`/api/removals/${r.id}/status`);
    expect(st.json.userAction.kind).toBe("MANUAL_OPT_OUT");
  });
});
