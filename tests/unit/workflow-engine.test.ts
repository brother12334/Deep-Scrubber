import { afterEach, describe, expect, it } from "vitest";
import { ExampleBrokerAgent } from "../../removal-agents/agents/example-broker";
import { MemoryRecorder, WorkflowEngine } from "../../removal-agents/engine/engine";
import { WorkflowDefinitionSchema } from "../../removal-agents/engine/definition";
import type { InboxReader } from "../../removal-agents/engine/types";
import { startMockBroker, type MockBroker } from "../../removal-agents/example-broker/mock-server";
import type { AgentContext } from "../../removal-agents/types";
import { buildSubject } from "../../core/subject";
import { devHttp, exampleBrokerSource, exampleBrokerWorkflow } from "../helpers/agents";
import { johnSubject } from "../helpers/subject";

let broker: MockBroker | undefined;
afterEach(async () => {
  await broker?.close();
  broker = undefined;
});

const ctxFor = (b: MockBroker, over: Partial<AgentContext> = {}): AgentContext => ({
  source: exampleBrokerSource(),
  baseUrl: b.url,
  http: devHttp(),
  now: () => new Date(),
  workflow: { definition: exampleBrokerWorkflow(), configId: null },
  ...over,
});

const record = (b: MockBroker, id = "p-1001") => ({
  id: "r1",
  url: `${b.url}/profile/${id}`,
  sourceId: "example-broker",
  category: "DATA_BROKER" as const,
  dataTypes: ["NAME", "PHONE", "HOME_ADDRESS"] as never,
  isSearchResult: false,
  searchEngine: null,
});

describe("ExampleBroker agent + workflow engine", () => {
  it("discovers the subject's profile through the broker's public search and matches it", async () => {
    broker = await startMockBroker();
    const agent = new ExampleBrokerAgent();
    const ctx = ctxFor(broker);
    const found = await agent.discover(ctx, johnSubject());
    expect(found.length).toBe(1); // the Portland, OR namesake is filtered by the state query
    const m = agent.identifyMatch(johnSubject(), found[0]!);
    expect(m.band).toBe("VERY_STRONG");
  });

  it("submits the official opt-out and completes without email verification", async () => {
    broker = await startMockBroker({ requireEmailVerification: false });
    const agent = new ExampleBrokerAgent();
    const recorder = new MemoryRecorder();
    const res = await agent.submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder,
    });
    expect(res.status).toBe("SUBMITTED");
    if (res.status === "SUBMITTED") {
      expect(res.confirmationRef).toMatch(/^EB-\d+$/);
      expect(res.sourceReportsCompleted).toBe(true);
    }
    expect(broker.people.get("p-1001")!.removed).toBe(true);
    // Workflow context persisted to the DB must not contain personal data.
    expect(JSON.stringify(recorder.lastState!.context)).not.toMatch(/john@example\.com|John Example/i);
    expect(recorder.lastState!.secure.selectedUrl).toContain("/profile/p-1001");
    expect((await agent.verifyRemoval(ctxFor(broker), record(broker), johnSubject())).outcome).toBe("REMOVED_FROM_SOURCE");
  });

  it("pauses for approval when not pre-authorised, then resumes", async () => {
    broker = await startMockBroker({ requireEmailVerification: false });
    const agent = new ExampleBrokerAgent();
    const recorder = new MemoryRecorder();
    const first = await agent.submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: false,
      request: {},
      recorder,
    });
    expect(first.status).toBe("REQUIRES_USER_ACTION");
    if (first.status !== "REQUIRES_USER_ACTION") return;
    expect(first.action.kind).toBe("CONFIRM_SUBMISSION");
    expect(broker.requests.length).toBe(0);
    const resumed = await agent.submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { ...first.state, currentStep: first.stepIndex + 1 },
      preAuthorized: true,
      request: {},
      recorder,
    });
    expect(resumed.status).toBe("SUBMITTED");
  });

  it("confirms email automatically through the relay inbox, following only links back to the source", async () => {
    const inboxMessages: Array<{ id: string; fromDomain: string; body: string; receivedAt: Date }> = [];
    broker = await startMockBroker({
      requireEmailVerification: true,
      onEmail: (m) => {
        inboxMessages.push({ id: String(inboxMessages.length + 1), fromDomain: "127.0.0.1", body: m.body, receivedAt: new Date() });
      },
    });
    const inbox: InboxReader = {
      async find({ pattern }) {
        return inboxMessages.find((m) => pattern.test(m.body));
      },
      async consume() {},
    };
    const subject = buildSubject("p1", [
      { type: "FULL_NAME", value: "John Example", isPrevious: false },
      { type: "LOCATION", value: "Boca Raton, FL", isPrevious: false },
    ], { email: "r123@relay.test", isRelay: true });
    const res = await new ExampleBrokerAgent().submitRequest(ctxFor(broker, { inbox }), {
      record: record(broker),
      subject,
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder: new MemoryRecorder(),
    });
    expect(res.status).toBe("SUBMITTED");
    expect(broker.requests[0]!.status).toBe("completed");
    expect(broker.people.get("p-1001")!.removed).toBe(true);
  });

  it("asks the user to click the email link when no relay inbox is available", async () => {
    broker = await startMockBroker({ requireEmailVerification: true });
    const res = await new ExampleBrokerAgent().submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder: new MemoryRecorder(),
    });
    expect(res.status).toBe("REQUIRES_USER_ACTION");
    if (res.status === "REQUIRES_USER_ACTION") {
      expect(res.action.kind).toBe("EMAIL_VERIFICATION");
      expect(res.resume).toBe("next");
    }
  });

  it("never bypasses CAPTCHA: human verification pauses automation", async () => {
    broker = await startMockBroker({ captcha: true });
    const res = await new ExampleBrokerAgent().submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder: new MemoryRecorder(),
    });
    expect(res.status).toBe("REQUIRES_USER_ACTION");
    if (res.status === "REQUIRES_USER_ACTION") {
      expect(res.action.kind).toBe("HUMAN_VERIFICATION");
      expect(res.action.choices).toContain("continue_manually");
    }
    expect(broker.requests.length).toBe(0);
  });

  it("fails safely (non-retryable) when the site layout changes", async () => {
    broker = await startMockBroker({ requireEmailVerification: false });
    const def = exampleBrokerWorkflow();
    const broken = WorkflowDefinitionSchema.parse({
      ...def,
      steps: def.steps.map((s) => (s.id === "fill-email" ? { ...s, params: { ...s.params, field: "email_address" } } : s)),
    });
    const res = await new ExampleBrokerAgent().submitRequest(ctxFor(broker, { workflow: { definition: broken, configId: null } }), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder: new MemoryRecorder(),
    });
    expect(res).toMatchObject({ status: "FAILED", code: "LAYOUT_CHANGED", retryable: false });
    expect(broker.requests.length).toBe(0);
  });

  it("reports NOT_FOUND_AT_SOURCE when the listing is already gone", async () => {
    broker = await startMockBroker({ requireEmailVerification: false });
    broker.people.get("p-1001")!.removed = true;
    const res = await new ExampleBrokerAgent().submitRequest(ctxFor(broker), {
      record: record(broker),
      subject: johnSubject(),
      state: { currentStep: 0, context: {}, secure: {} },
      preAuthorized: true,
      request: {},
      recorder: new MemoryRecorder(),
    });
    expect(res.status).toBe("NOT_FOUND_AT_SOURCE");
  });

  it("refuses to repeat a submission whose previous attempt never finished", async () => {
    broker = await startMockBroker({ requireEmailVerification: false });
    const recorder = new MemoryRecorder();
    const def = exampleBrokerWorkflow();
    const submitIndex = def.steps.findIndex((s) => s.type === "SUBMIT");
    await recorder.start(submitIndex, "submit", "SUBMIT"); // simulated crash mid-submit
    const res = await new WorkflowEngine().run(
      def,
      { currentStep: submitIndex, context: {}, secure: {} },
      { base: broker.url, sourceDomain: "examplebroker.test", subject: {} as never, record: { url: "" } },
      { http: devHttp(), now: () => new Date(), preAuthorized: true, sourceName: "ExampleBroker" },
      recorder,
    );
    expect(res).toMatchObject({ kind: "FAILED", code: "SUBMISSION_STATE_UNKNOWN", retryable: false });
  });

  it("verification distinguishes removed-from-source vs still present vs no longer detected", async () => {
    broker = await startMockBroker();
    const agent = new ExampleBrokerAgent();
    expect((await agent.verifyRemoval(ctxFor(broker), record(broker), johnSubject())).outcome).toBe("STILL_PRESENT");
    broker.people.get("p-1001")!.name = "Someone Else";
    broker.people.get("p-1001")!.phone = "(555) 000-0000";
    broker.people.get("p-1001")!.email = "other@example.org";
    expect((await agent.verifyRemoval(ctxFor(broker), record(broker), johnSubject())).outcome).toBe("NO_LONGER_DETECTED");
    broker.people.get("p-1001")!.removed = true;
    expect((await agent.verifyRemoval(ctxFor(broker), record(broker), johnSubject())).outcome).toBe("REMOVED_FROM_SOURCE");
  });
});
