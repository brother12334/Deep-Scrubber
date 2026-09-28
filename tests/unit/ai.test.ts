import { describe, expect, it } from "vitest";
import { z } from "zod";
import { refineClassification } from "../../ai/classifier";
import type { LLMProvider } from "../../ai/provider";
import { NullProvider } from "../../ai/provider";
import { checkGuardrails, generateRemovalRequest, templateRequest, type RequestFacts } from "../../ai/request-generator";

const facts: RequestFacts = {
  recipientName: "ExampleBroker",
  method: "WEB_FORM",
  pathway: "DATA_BROKER_OPT_OUT",
  listingUrl: "https://examplebroker.test/profile/p-1001",
  dataTypes: ["NAME", "HOME_ADDRESS", "PHONE"],
  subjectName: "John Example",
  contactEmail: "john@example.com",
  userFacts: [],
  allowedFrameworks: [],
};

const fakeLLM = (out: unknown): LLMProvider => ({
  id: "fake",
  async generateJson<S extends z.ZodType>(p: { schema: S }) {
    const r = p.schema.safeParse(out);
    return r.success ? r.data : null;
  },
});

describe("removal request generator", () => {
  it("produces a template that passes its own guardrails", () => {
    const t = templateRequest(facts);
    expect(t.body).toContain(facts.listingUrl);
    expect(t.body).toMatch(/home address and phone number/);
    expect(checkGuardrails(t.body, facts)).toEqual([]);
    expect(t.reason).toMatch(/privacy opt-out process/);
  });

  it("only cites legal frameworks surfaced by the pathway engine", () => {
    const j = templateRequest({ ...facts, pathway: "JURISDICTIONAL_DELETION_REQUEST", allowedFrameworks: ["CCPA/CPRA"] });
    expect(j.body).toContain("CCPA/CPRA");
    expect(templateRequest(facts).body).not.toMatch(/CCPA|GDPR/);
  });

  it("uses AI output when it passes guardrails", async () => {
    const r = await generateRemovalRequest(facts, fakeLLM({ subject: "Opt-out request", body: `Hello, please remove my listing ${facts.listingUrl}. Thanks, John Example` }));
    expect(r.generatedBy).toBe("ai");
  });

  it("rejects AI output that invents rights, threats or contact details", async () => {
    for (const body of [
      `Under GDPR Article 17 you must delete ${facts.listingUrl}.`,
      `Delete ${facts.listingUrl} or my attorney will file a lawsuit.`,
      `Delete ${facts.listingUrl}. Reach me at other@evil.test`,
      `Delete ${facts.listingUrl} and https://unrelated.example/x`,
      "Please delete my data.",
    ]) {
      const r = await generateRemovalRequest(facts, fakeLLM({ subject: "x", body }));
      expect(r.generatedBy).toBe("template");
      expect(r.guardrailViolations.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the template when no AI provider is configured", async () => {
    expect((await generateRemovalRequest(facts, new NullProvider())).generatedBy).toBe("template");
  });
});

describe("AI classification", () => {
  it("cannot override a registry classification", async () => {
    const det = { category: "DATA_BROKER" as const, sourceId: "example-broker", publicInterest: false, reason: "registry" };
    const r = await refineClassification(fakeLLM({ category: "SOCIAL", data_types: [], public_interest: true, rationale: "x" }), { url: "u", text: "t", deterministic: det });
    expect(r).toEqual(det);
  });
  it("can add context to unclassified results but never marks them user-controlled", async () => {
    const det = { category: "OTHER" as const, publicInterest: false, reason: "none" };
    const r = await refineClassification(fakeLLM({ category: "USER_CONTROLLED", data_types: ["PHONE"], public_interest: false, rationale: "x" }), { url: "u", text: "t", deterministic: det });
    expect(r.category).toBe("OTHER");
  });
});
