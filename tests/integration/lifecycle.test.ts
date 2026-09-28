import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobNames } from "../../backend/src/infra/queue";
import { createHarness, createJohnProfile, signupVerified, type Client, type Harness } from "../helpers/harness";

/**
 * End-to-end lifecycle on the Pro plan with blanket authorization:
 * DISCOVER → MATCH → CLASSIFY → PRIORITIZE → REQUEST REMOVAL → VERIFY → MONITOR → REAPPEAR → REPEAT
 */
describe("automated lifecycle (Pro, automatic mode, relay email)", () => {
  let h: Harness;
  let c: Client;
  let profileId: string;

  beforeAll(async () => {
    h = await createHarness();
    c = await signupVerified(h, "john@example.com", "PRO");
    profileId = await createJohnProfile(c);
    const patch = await c.patch(`/api/profile/${profileId}`, { defaultApprovalMode: "AUTOMATIC", blanketAuthorization: true, useRelayEmail: true });
    expect(patch.status).toBe(200);
    expect(patch.json.profile.relayEmail).toMatch(/@relay\.test$/);
  });
  afterAll(() => h.close());

  it("scans, matches, classifies and prioritises exposures", async () => {
    const scan = await c.post("/api/scans");
    expect(scan.status).toBe(202);
    await h.drain();
    const s = await c.get(`/api/scans/${scan.json.scan.id}`);
    expect(s.json.scan.status).toBe("COMPLETED");
    expect(s.json.scan.stats.discardedLowConfidence).toBeGreaterThanOrEqual(1); // the Portland namesake is never stored

    const ex = await c.get("/api/exposures?includeSearch=false&limit=100");
    const byDomain = Object.fromEntries(ex.json.items.map((i: any) => [i.domain, i]));
    const broker = ex.json.items.find((i: any) => i.sourceId === "example-broker");
    expect(broker).toMatchObject({ category: "DATA_BROKER", matchBand: "VERY_STRONG", priorityLevel: "HIGH" });
    expect(byDomain["examplemirror.test"]).toMatchObject({ sourceId: "example-mirror", category: "PEOPLE_SEARCH" });
    expect(byDomain["github.com"]).toMatchObject({ category: "PROFESSIONAL" });
    expect(byDomain["citynews.example"]).toMatchObject({ publicInterest: true, status: "NO_ACTION_AVAILABLE" });
    expect(ex.json.items.some((i: any) => i.domain === "people.example")).toBe(false);

    // Mirror depends on the broker record (dependency graph) and they share a cluster.
    expect(byDomain["examplemirror.test"].parentRecordId).toBe(broker.id);
    const clusters = await c.get("/api/exposures/clusters");
    const cluster = clusters.json.clusters.find((cl: any) => cl.memberIds.includes(broker.id));
    expect(cluster.recommendedAction).toMatch(/Remove from ExampleBroker first/);
    expect(cluster.searchAppearances["Fixture Search"]).toBeGreaterThanOrEqual(1);

    const map = await c.get("/api/exposures/map");
    expect(map.json.nodes.find((n: any) => n.key === "brokers").sources).toBeGreaterThanOrEqual(2);
  });

  it("automatically submits the broker opt-out and confirms the email via the relay alias", async () => {
    const reqs = await c.get("/api/removals");
    const brokerReq = reqs.json.requests.find((r: any) => r.sourceName === "ExampleBroker");
    expect(brokerReq.status).toBe("AWAITING_VERIFICATION");
    expect(brokerReq.confirmationRef).toMatch(/^EB-/);
    expect(h.broker.requests[0]!.status).toBe("completed");

    const detail = await c.get(`/api/removals/${brokerReq.id}`);
    expect(detail.json.request.body).toContain("/profile/p-1001");
    expect(detail.json.request.pathway.pathway).toBe("DATA_BROKER_OPT_OUT");
    expect(detail.json.request.timeline.map((t: any) => t.step)).toEqual(expect.arrayContaining(["search", "submit", "verify-email"]));

    // Mirror is guided-manual; directory is an email request awaiting approval? No — AUTOMATIC mode sends it.
    const mirror = reqs.json.requests.find((r: any) => r.sourceName === "ExampleMirror");
    expect(mirror.status).toBe("REQUIRES_USER_ACTION");
    expect(mirror.userAction.kind).toBe("MANUAL_OPT_OUT");
    const dir = reqs.json.requests.find((r: any) => r.sourceName === "ExampleDirectory");
    expect(dir.status).toBe("AWAITING_VERIFICATION");
    expect(h.mailer.sent.some((m) => m.to === "privacy@exampledirectory.test" && m.text.includes("exampledirectory.test/listing"))).toBe(true);
  });

  it("verifies removal after the provider's processing time and cascades to downstream records", async () => {
    h.clock.advanceDays(3.1);
    await h.drain();
    const ex = await c.get("/api/exposures?limit=100");
    const broker = ex.json.items.find((i: any) => i.sourceId === "example-broker" && !i.isSearchResult);
    expect(broker.status).toBe("REMOVED");
    expect(broker.removalOutcome).toBe("REMOVED_FROM_SOURCE");

    // The fixture engine still lists the broker URL → origin gone, result outdated → user action to refresh.
    const appearance = ex.json.items.find((i: any) => i.isSearchResult && i.parentRecordId === broker.id);
    expect(appearance.status).toBe("REQUIRES_USER_ACTION");
    const detail = await c.get(`/api/exposures/${appearance.id}`);
    expect(detail.json.pathways[0].pathway).toBe("OUTDATED_CONTENT");

    const dash = await c.get("/api/dashboard");
    expect(dash.json.cards.removed).toBeGreaterThanOrEqual(1);
    expect(dash.json.recentActivity.some((a: any) => a.kind === "REMOVED")).toBe(true);
    const monitoring = await c.get("/api/monitoring");
    expect(monitoring.json.jobs.some((j: any) => j.record_id === broker.id && j.active)).toBe(true);
  });

  it("detects reappearance during monitoring and re-submits in automatic mode", async () => {
    h.broker.regenerate("p-1001");
    const before = h.broker.requests.length;
    h.clock.advanceDays(1.1);
    await h.ctx.queue.enqueue(JobNames.MonitoringTick, {});
    await h.drain();
    const ex = await c.get("/api/exposures?includeSearch=false&limit=100");
    const broker = ex.json.items.find((i: any) => i.sourceId === "example-broker");
    expect(["REAPPEARED", "AWAITING_VERIFICATION", "READY"]).toContain(broker.status);
    const notes = await c.get("/api/notifications");
    expect(notes.json.notifications.some((n: any) => n.kind === "REAPPEARED")).toBe(true);
    expect(h.broker.requests.length).toBeGreaterThan(before);
  });

  it("explains the privacy score and its history", async () => {
    const hist = await c.get("/api/score/history");
    expect(hist.json.history.length).toBeGreaterThanOrEqual(2);
    expect(hist.json.history[0].change.reasons.length).toBeGreaterThan(0);
  });

  it("produces reports that distinguish removal outcomes", async () => {
    const r = await c.get("/api/reports/summary");
    expect(r.json.initialExposures).toBeGreaterThan(0);
    expect(r.json.outcomes).toHaveProperty("removedFromSource");
    const csv = await c.get("/api/reports/export.csv");
    expect(csv.raw.split("\n")[0]).toContain("removal_outcome");
    expect(csv.raw).not.toContain("john@example.com");
    const pdf = await c.get("/api/reports/export.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.raw.startsWith("%PDF")).toBe(true);
  });

  it("keeps PII encrypted at rest", async () => {
    const rows = await h.ctx.db.query<{ t: string }>(
      `SELECT row_to_json(x)::text AS t FROM (SELECT * FROM identifiers) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM discovered_records) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM removal_requests) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM removal_workflows) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM users) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM audit_logs) x
       UNION ALL SELECT row_to_json(x)::text FROM (SELECT * FROM notifications) x`,
    );
    const dump = rows.map((r) => r.t).join("\n");
    for (const secret of ["john@example.com", "555-1234", "5555551234", "John Example", "Boca Raton", "p-1001", "jexample"]) {
      expect(dump.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("exports and permanently deletes the account", async () => {
    const exp = await c.get("/api/account/export");
    expect(exp.status).toBe(200);
    const data = JSON.parse(exp.raw);
    expect(data.profiles[0].identifiers.some((i: any) => i.value === "john@example.com")).toBe(true);
    const bad = await c.del("/api/account", { password: "wrong-password-here", confirm: "DELETE" });
    expect(bad.status).toBe(401);
    const del = await c.del("/api/account", { password: "a-very-long-password-123", confirm: "DELETE" });
    expect(del.status).toBe(200);
    const left = await h.ctx.db.one<{ n: number }>("SELECT (SELECT count(*) FROM discovered_records) + (SELECT count(*) FROM identifiers) + (SELECT count(*) FROM users) AS n");
    expect(left!.n).toBe(0);
  });
});
