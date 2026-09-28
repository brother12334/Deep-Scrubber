import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createJohnProfile, signupVerified, type Client, type Harness } from "../helpers/harness";

describe("focused searches for arrest-related content", () => {
  let h: Harness;
  let c: Client;
  let profileId: string;

  beforeAll(async () => {
    h = await createHarness();
    c = await signupVerified(h, "john@example.com", "PRO");
    profileId = await createJohnProfile(c);
  });
  afterAll(async () => {
    expect(h.queue.errors.map((f) => `${f.name}: ${f.error}`)).toEqual([]);
    await h.close();
  });

  it("rejects malformed custom terms", async () => {
    expect((await c.post("/api/scans", { customTerms: ['" OR site:evil'] })).status).toBe(400);
  });

  it("searches the chosen topic and classifies what it finds", async () => {
    const before = h.search.queries.length;
    const r = await c.post("/api/scans", { topics: ["ARREST"], customTerms: ["trespassing"] });
    expect(r.status).toBe(202);
    await h.drain();
    const queries = h.search.queries.slice(before);
    expect(queries[0]).toBe('"John Example" trespassing');
    expect(queries).toContain('"John Example" arrest');

    const ex = (await c.get("/api/exposures?includeSearch=false&limit=100")).json.items;
    const mug = ex.find((i: any) => i.domain === "mugshotsite.example");
    const news = ex.find((i: any) => i.domain === "sunsentinelnews.example");
    // Name + city is a "possible" match: nothing happens until the user confirms it's really them.
    expect(mug).toMatchObject({ category: "MUGSHOT_OR_ARREST_RECORD", status: "NEEDS_REVIEW" });
    expect(mug.dataTypes).toContain("ARREST_OR_COURT_RECORD");
    expect(news).toMatchObject({ category: "NEWS_OR_PUBLIC_INTEREST", publicInterest: true, status: "NO_ACTION_AVAILABLE" });
    expect((await c.get("/api/removals")).json.requests.some((x: any) => x.recordId === mug.id)).toBe(false);
    expect((await c.post(`/api/exposures/${mug.id}/confirm`)).status).toBe(200);

    const mugReq = (await c.get("/api/removals")).json.requests.find((x: any) => x.recordId === mug.id);
    expect(mugReq.pathway).toBe("MUGSHOT_REMOVAL");
    expect(mugReq.userAction.instructions.join(" ")).toMatch(/removal fee/);
    // Nothing is ever sent automatically for arrest-related content.
    expect(h.mailer.sent.some((m) => m.text.includes("mugshotsite.example"))).toBe(false);
  });

  it("won't create a removal request for news coverage without a favorable outcome", async () => {
    const news = (await c.get("/api/exposures?includeSearch=false&limit=100")).json.items.find((i: any) => i.domain === "sunsentinelnews.example");
    const r = await c.post("/api/removals", { recordId: news.id });
    expect(r.status).toBe(400);
    const d = await c.get(`/api/exposures/${news.id}`);
    expect(d.json.pathways.some((p: any) => p.pathway === "RECORD_SEALING")).toBe(true);
  });

  it("offers a publisher update request once the case outcome is recorded", async () => {
    expect((await c.patch(`/api/profile/${profileId}`, { caseOutcome: "DISMISSED" })).status).toBe(200);
    const news = (await c.get("/api/exposures?includeSearch=false&limit=100")).json.items.find((i: any) => i.domain === "sunsentinelnews.example");
    const d = await c.get(`/api/exposures/${news.id}`);
    expect(d.json.pathways[0].pathway).toBe("NEWS_UPDATE_REQUEST");
    // Still a "possible" match, so it must be confirmed before any request is prepared.
    expect((await c.post("/api/removals", { recordId: news.id })).status).toBe(400);
    expect((await c.post(`/api/exposures/${news.id}/confirm`)).status).toBe(200);
    const r = await c.post("/api/removals", { recordId: news.id });
    expect(r.status).toBe(201);
    expect(r.json.request.pathway.pathway).toBe("NEWS_UPDATE_REQUEST");
    expect(r.json.request.status).toBe("REQUIRES_USER_ACTION");
    expect(r.json.request.body).toMatch(/The case was dismissed/);
    expect(r.json.request.userAction.title).toBe("Ask the publisher to update the article");
  });
});
