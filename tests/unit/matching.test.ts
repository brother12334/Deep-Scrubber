import { describe, expect, it } from "vitest";
import { extractAttributes } from "../../core/extract";
import { bandFor, canAutoSubmit, scoreMatch } from "../../core/matching";
import { johnSubject } from "../helpers/subject";
import { buildSubject } from "../../core/subject";

const now = new Date("2026-09-28T00:00:00Z");

describe("identity matching engine", () => {
  const s = johnSubject();

  it("a name alone is never more than a weak match", () => {
    const m = scoreMatch(s, extractAttributes("John Example is a name that appears here.", s), { now });
    expect(m.confidence).toBeLessThan(0.6);
    expect(["WEAK", "UNRELATED"]).toContain(m.band);
    expect(canAutoSubmit(m.confidence, null)).toBe(false);
  });

  it("name + city/state + consistent age is a strong match", () => {
    const m = scoreMatch(s, extractAttributes("John Example, Age 41, Boca Raton, FL", s), { now, targetedSearch: true });
    expect(m.confidence).toBeGreaterThanOrEqual(0.8);
    expect(m.factors.map((f) => f.factor)).toEqual(expect.arrayContaining(["name", "location", "age"]));
  });

  it("name + phone is a very strong match", () => {
    const m = scoreMatch(s, extractAttributes("John Example — call (555) 555-1234", s), { now });
    expect(m.band).toBe("VERY_STRONG");
  });

  it("contradicting evidence (wrong age, other state) lowers confidence", () => {
    const m = scoreMatch(s, extractAttributes("John Example, Age 67, Portland, OR", s), { now, targetedSearch: true });
    expect(m.confidence).toBeLessThan(0.4);
    expect(m.factors.some((f) => f.effect === "contradicts")).toBe(true);
  });

  it("username in the URL path counts as evidence", () => {
    const m = scoreMatch(s, extractAttributes("John Example profile", s, { url: "https://github.com/jexample" }), {
      now,
      url: "https://github.com/jexample",
    });
    expect(m.factors.some((f) => f.factor === "username")).toBe(true);
    expect(m.confidence).toBeGreaterThan(0.8);
  });

  it("maps thresholds to spec bands", () => {
    expect(bandFor(0.95)).toBe("VERY_STRONG");
    expect(bandFor(0.8)).toBe("STRONG");
    expect(bandFor(0.6)).toBe("POSSIBLE");
    expect(bandFor(0.4)).toBe("WEAK");
    expect(bandFor(0.39)).toBe("UNRELATED");
  });

  it("user confirmation can authorise a possible match; rejection always blocks", () => {
    expect(canAutoSubmit(0.6, true)).toBe(true);
    expect(canAutoSubmit(0.99, false)).toBe(false);
  });

  it("recognises full state names the way news articles write them", () => {
    const m = scoreMatch(s, extractAttributes("John Example, 41, of Boca Raton, Florida was charged on Tuesday.", s), { now });
    expect(m.factors.some((f) => f.factor === "location")).toBe(true);
    expect(m.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("counts a bare mention of the subject's city as supporting evidence", () => {
    const m = scoreMatch(s, extractAttributes("Boca Raton police said John Example was released.", s), { now });
    expect(m.factors.some((f) => f.factor === "city_mention")).toBe(true);
    expect(m.confidence).toBeGreaterThanOrEqual(0.6); // kept for review instead of discarded
    expect(m.confidence).toBeLessThan(0.8); // but never auto-actionable on this alone
  });

  it("does not treat an unrelated city as the subject's", () => {
    const m = scoreMatch(s, extractAttributes("John Example of Portland, Oregon spoke at the event.", s), { now });
    expect(m.confidence).toBeLessThan(0.4);
  });

  it("accepts profile locations written with a full state name", () => {
    const t = buildSubject("p2", [
      { type: "FULL_NAME", value: "Jane Sample", isPrevious: false },
      { type: "LOCATION", value: "Austin, Texas", isPrevious: false },
    ]);
    expect(t.locations[0]).toEqual({ city: "austin", region: "tx" });
    expect(scoreMatch(t, extractAttributes("Jane Sample - Austin, TX", t)).confidence).toBeGreaterThanOrEqual(0.6);
  });
});
