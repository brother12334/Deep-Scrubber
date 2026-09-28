import { describe, expect, it } from "vitest";
import { templateRequest, checkGuardrails } from "../../ai/request-generator";
import { classifyResult } from "../../core/classification";
import { dataTypesFor, extractAttributes } from "../../core/extract";
import { suggestPathways, type PathwayInput } from "../../core/pathways";
import { expandQueries } from "../../core/queries";
import { validateFocus } from "../../core/topics";
import { johnSubject } from "../helpers/subject";

const registry = { byDomain: () => undefined };

describe("focused topic searches", () => {
  it("puts topic queries first, always anchored to the subject's name", () => {
    const qs = expandQueries(johnSubject(), 8, { topics: ["ARREST"], customTerms: [] }).map((q) => q.q);
    expect(qs.slice(0, 3)).toEqual(['"John Example" arrest', '"John Example" arrested', '"John Example" mugshot']);
    expect(qs.every((q) => q.includes("John Example") || q.includes("@") || /\d{3}/.test(q))).toBe(true);
    expect(qs.length).toBeLessThanOrEqual(8);
  });

  it("validates custom terms", () => {
    expect(validateFocus({ topics: ["ARREST", "BOGUS"], customTerms: ["DUI", "  dui "] })).toEqual({ topics: ["ARREST"], customTerms: ["dui"] });
    expect(() => validateFocus({ customTerms: ["a", "b", "c", "d"].map((x) => `${x}${x}`) })).toThrow(/at most 3/);
    expect(() => validateFocus({ customTerms: ['" OR site:x'] })).toThrow();
  });
});

describe("arrest-related classification and pathways", () => {
  const s = johnSubject();
  it("classifies mugshot sites and flags arrest data", () => {
    const c = classifyResult("https://mugshotsite.example/fl/john-example", "John Example booking photo", registry);
    expect(c).toMatchObject({ category: "MUGSHOT_OR_ARREST_RECORD", publicInterest: false });
    expect(dataTypesFor(extractAttributes("John Example was arrested and charged with theft", s))).toContain("ARREST_OR_COURT_RECORD");
  });

  it("treats official court sites as public records and news as public interest", () => {
    expect(classifyResult("https://courts.state.fl.us/case/1", "docket for defendant", registry)).toMatchObject({ category: "COURT_RECORD", publicInterest: true });
    expect(classifyResult("https://citynews.example/a", "Police said the man was arrested, according to a report", registry).publicInterest).toBe(true);
  });

  const base: PathwayInput = {
    category: "NEWS_OR_PUBLIC_INTEREST",
    isSearchResult: false,
    sourceRemovalMethods: [],
    userOwnsDomain: false,
    originGone: false,
    dataTypes: ["NAME", "ARREST_OR_COURT_RECORD"],
    publicInterest: true,
    jurisdictionMechanisms: [],
  };

  it("offers a publisher update request only after a favorable outcome", () => {
    expect(suggestPathways(base).some((p) => p.pathway === "NEWS_UPDATE_REQUEST")).toBe(false);
    const p = suggestPathways({ ...base, caseOutcome: "DISMISSED" });
    expect(p[0]).toMatchObject({ pathway: "NEWS_UPDATE_REQUEST", confidence: "MEDIUM" });
    expect(p[0]!.why).toMatch(/was dismissed/);
    expect(suggestPathways({ ...base, caseOutcome: "CONVICTED" }).some((x) => x.pathway === "NEWS_UPDATE_REQUEST")).toBe(false);
  });

  it("mugshot sites get a removal pathway; sealing is suggested unless already sealed", () => {
    const m = { ...base, category: "MUGSHOT_OR_ARREST_RECORD" as const, publicInterest: false };
    expect(suggestPathways(m)[0]).toMatchObject({ pathway: "MUGSHOT_REMOVAL", confidence: "MEDIUM" });
    expect(suggestPathways({ ...m, caseOutcome: "ACQUITTED" })[0]).toMatchObject({ pathway: "MUGSHOT_REMOVAL", confidence: "HIGH" });
    expect(suggestPathways(m).some((x) => x.pathway === "RECORD_SEALING")).toBe(true);
    expect(suggestPathways({ ...m, caseOutcome: "EXPUNGED_OR_SEALED" }).some((x) => x.pathway === "RECORD_SEALING")).toBe(false);
  });

  it("drafts a polite update request that passes the guardrails", () => {
    const f = {
      recipientName: "City News",
      method: "WEB_FORM" as const,
      pathway: "NEWS_UPDATE_REQUEST" as const,
      listingUrl: "https://citynews.example/a",
      dataTypes: ["NAME", "ARREST_OR_COURT_RECORD"] as never,
      subjectName: "John Example",
      contactEmail: "john@example.com",
      userFacts: [],
      allowedFrameworks: [],
      caseOutcome: "DISMISSED" as const,
    };
    const t = templateRequest(f);
    expect(t.body).toContain("The case was dismissed.");
    expect(t.body).toContain("update the article");
    expect(checkGuardrails(t.body, f)).toEqual([]);
  });
});
