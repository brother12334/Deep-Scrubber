import { describe, expect, it } from "vitest";
import { classifyResult } from "../../core/classification";
import { clusterFingerprint, summarizeCluster } from "../../core/clustering";
import { downstreamOf, removalOrder } from "../../core/dependencies";
import { extractAttributes } from "../../core/extract";
import { nextRecheck } from "../../core/monitoring";
import { canonicalUrl, normalizePhone, validateIdentifier } from "../../core/normalize";
import { suggestPathways } from "../../core/pathways";
import { prioritize } from "../../core/prioritization";
import { expandQueries } from "../../core/queries";
import { computeReliability, evaluateHealth } from "../../core/reliability";
import { computePrivacyScore, explainScoreChange } from "../../core/scoring";
import { assessProfileAbuse } from "../../core/abuse";
import { johnSubject } from "../helpers/subject";

const registry = { byDomain: (d: string) => (d === "examplebroker.test" ? { id: "example-broker", categories: ["DATA_BROKER"] } : undefined) };

describe("normalisation", () => {
  it("normalises phones and URLs", () => {
    expect(normalizePhone("(555) 555-1234")).toBe("+15555551234");
    expect(canonicalUrl("https://www.Example.com/a/?utm_source=x#frag")).toBe("https://example.com/a");
  });
  it("validates identifiers", () => {
    expect(validateIdentifier("EMAIL", "nope")).toBeTruthy();
    expect(validateIdentifier("FULL_NAME", "Cher")).toBeTruthy();
    expect(validateIdentifier("FULL_NAME", "John Example")).toBeNull();
  });
});

describe("classification", () => {
  it("prefers the registry, including subdomains", () => {
    expect(classifyResult("https://people.examplebroker.test/x", "", registry).sourceId).toBe("example-broker");
  });
  it("detects user-controlled domains and public-interest content", () => {
    expect(classifyResult("https://blog.johnexample.dev/about", "", registry, ["johnexample.dev"]).category).toBe("USER_CONTROLLED");
    const news = classifyResult("https://citynews.example/story", "according to organizers", registry);
    expect(news.publicInterest).toBe(true);
  });
});

describe("prioritisation", () => {
  it("ranks home address + phone on a broker as HIGH", () => {
    const p = prioritize({
      dataTypes: ["NAME", "HOME_ADDRESS", "PHONE", "AGE_OR_DOB"],
      confidence: 0.95,
      category: "DATA_BROKER",
      isSearchResult: false,
      hasOrigin: false,
      searchAppearances: 2,
      bestSearchRank: 3,
      automationStatus: "AUTOMATED",
      publicInterest: false,
    });
    expect(p.level).toBe("HIGH");
    expect(p.factors.find((f) => f.factor === "sensitivity")).toBeTruthy();
  });
  it("never prioritises public-interest content", () => {
    const p = prioritize({ dataTypes: ["NAME", "HOME_ADDRESS", "PHONE"], confidence: 0.9, category: "OTHER", isSearchResult: false, hasOrigin: false, searchAppearances: 3, publicInterest: true });
    expect(p.level).toBe("LOW");
  });
  it("halves downstream search appearances", () => {
    const base = { dataTypes: ["NAME", "PHONE"] as const, confidence: 0.9, category: "SEARCH_RESULT" as const, searchAppearances: 1, publicInterest: false };
    const a = prioritize({ ...base, dataTypes: [...base.dataTypes], isSearchResult: true, hasOrigin: true });
    const b = prioritize({ ...base, dataTypes: [...base.dataTypes], isSearchResult: true, hasOrigin: false });
    expect(a.score).toBeLessThan(b.score);
  });
});

describe("privacy score", () => {
  const rec = (status: string, level: "HIGH" | "MEDIUM" | "LOW", extra = {}) =>
    ({ status, priorityLevel: level, category: "DATA_BROKER", isSearchResult: false, hasParent: false, publicInterest: false, ...extra }) as never;
  it("is 100 with nothing found and explains penalties", () => {
    expect(computePrivacyScore([]).score).toBe(100);
    const s = computePrivacyScore([rec("READY", "HIGH"), rec("REMOVED", "HIGH"), rec("READY", "LOW")]);
    expect(s.score).toBe(100 - 6 - 1);
    expect(s.counts.removed).toBe(1);
  });
  it("explains exactly why the score changed", () => {
    const before = computePrivacyScore([rec("READY", "HIGH"), rec("READY", "HIGH")]);
    const after = computePrivacyScore([rec("REMOVED", "HIGH"), rec("READY", "HIGH")]);
    const change = explainScoreChange(before, after);
    expect(change.delta).toBe(6);
    expect(change.reasons[0]).toMatch(/−1 high-priority exposures \(\+6 points\)/);
  });
});

describe("clustering and dependencies", () => {
  it("fingerprints only the subject's identifiers present", () => {
    const s = johnSubject();
    const a = extractAttributes("John Example (555) 555-1234 123 Palm Tree Ave", s);
    const b = extractAttributes("JOHN EXAMPLE — 555.555.1234 — 123 Palm Tree Ave — ads ads", s);
    expect(clusterFingerprint({ sourceFamily: "example-broker", subject: s, attributes: a })).toBe(
      clusterFingerprint({ sourceFamily: "example-broker", subject: s, attributes: b }),
    );
  });
  it("recommends removing from the origin first", () => {
    const summary = summarizeCluster(
      [
        { id: "o", sourceId: "example-broker", isSearchResult: false, parentRecordId: null, searchEngine: null },
        { id: "g1", sourceId: null, isSearchResult: true, parentRecordId: "o", searchEngine: "Google" },
        { id: "g2", sourceId: null, isSearchResult: true, parentRecordId: "o", searchEngine: "Google" },
        { id: "b1", sourceId: null, isSearchResult: true, parentRecordId: "o", searchEngine: "Bing" },
      ],
      new Map([["example-broker", "ExampleBroker"]]),
    );
    expect(summary.originRecordId).toBe("o");
    expect(summary.searchAppearances).toEqual({ Google: 2, Bing: 1 });
    expect(summary.recommendedAction).toMatch(/Remove from ExampleBroker first/);
  });
  it("walks the dependency graph", () => {
    const nodes = [
      { id: "src", parentId: null },
      { id: "mirror", parentId: "src" },
      { id: "g", parentId: "src" },
      { id: "cache", parentId: "g" },
    ];
    expect(downstreamOf("src", nodes).sort()).toEqual(["cache", "g", "mirror"]);
    expect(removalOrder(nodes)[0]).toBe("src");
  });
});

describe("pathways", () => {
  it("suggests a data-broker opt-out with high confidence and never asserts legal conclusions", () => {
    const p = suggestPathways({
      category: "DATA_BROKER",
      isSearchResult: false,
      sourceRemovalMethods: ["WEB_FORM"],
      userOwnsDomain: false,
      originGone: false,
      dataTypes: ["HOME_ADDRESS"],
      publicInterest: false,
      jurisdictionMechanisms: ["JURISDICTIONAL_DELETION_REQUEST"],
      jurisdictionName: "California",
    });
    expect(p[0]).toMatchObject({ pathway: "DATA_BROKER_OPT_OUT", confidence: "HIGH" });
    const j = p.find((x) => x.pathway === "JURISDICTIONAL_DELETION_REQUEST")!;
    expect(j.why).toMatch(/may provide/);
    expect(j.caveat).toMatch(/not legal advice/);
  });
  it("uses outdated-content for search results whose origin is gone", () => {
    const p = suggestPathways({ category: "SEARCH_RESULT", isSearchResult: true, sourceRemovalMethods: [], userOwnsDomain: false, originGone: true, dataTypes: ["NAME"], publicInterest: false, jurisdictionMechanisms: [] });
    expect(p[0]?.pathway).toBe("OUTDATED_CONTENT");
  });
});

describe("monitoring schedule", () => {
  it("follows day 1, 3, 7, 14, 30 then the configured interval", () => {
    let at = new Date("2026-01-01T00:00:00Z");
    const days: number[] = [];
    let step = 0;
    const start = at.getTime();
    for (let i = 0; i < 7; i++) {
      const n = nextRecheck(at, step, 30);
      at = n.at;
      step = n.step;
      days.push(Math.round((at.getTime() - start) / 86_400_000));
    }
    expect(days).toEqual([1, 3, 7, 14, 30, 60, 90]);
  });
});

describe("query expansion", () => {
  it("is bounded and never includes DOB or street address", () => {
    const qs = expandQueries(johnSubject());
    expect(qs.length).toBeLessThanOrEqual(30);
    expect(qs.map((q) => q.q)).toEqual(expect.arrayContaining(['"John Example"', '"John Example" address', '"john@example.com"', '"555-555-1234"']));
    expect(qs.some((q) => q.q.includes("1985"))).toBe(false);
  });
});

describe("reliability and health", () => {
  it("refuses to show statistics without enough data", () => {
    expect(computeReliability({ completed: 3, removed: 3, failed: 0, reappeared: 0, avgRemovalDays: 2 }).successRate).toBeNull();
    const r = computeReliability({ completed: 20, removed: 18, failed: 2, reappeared: 1, avgRemovalDays: 4.23 });
    expect(r).toMatchObject({ successRate: 0.9, averageRemovalDays: 4.2, reappearance: "Low" });
  });
  it("trips the circuit breaker above the threshold", () => {
    expect(evaluateHealth({ succeeded: 7, failed: 3 }, 0.25, 8).shouldPause).toBe(true);
    expect(evaluateHealth({ succeeded: 2, failed: 3 }, 0.25, 8).shouldPause).toBe(false);
  });
});

describe("abuse heuristics", () => {
  it("flags profiles that mix many unrelated people", () => {
    const s = assessProfileAbuse({ distinctNames: 5, distinctLastNames: 5, emailsClaimedByOtherAccounts: 0, phonesClaimedByOtherAccounts: 0, identifierChurnLast24h: 0 });
    expect(s[0]?.code).toBe("MANY_UNRELATED_NAMES");
  });
});
