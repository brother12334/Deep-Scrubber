import http from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * A self-contained fake data broker used for local development, demos and
 * integration tests. It mimics the shape of a typical people-search site:
 * public search, profile pages, an official opt-out form with a CSRF token,
 * email confirmation, a status endpoint, and records that can "regenerate".
 *
 * It is NOT a model of any real company.
 */

export interface MockPerson {
  id: string;
  name: string;
  city: string;
  state: string;
  age: number;
  phone: string;
  email: string;
  street: string;
  relatives: string[];
  removed: boolean;
}

export interface MockBrokerOptions {
  port?: number;
  requireEmailVerification?: boolean;
  captcha?: boolean;
  /** Called when the broker "sends" an email. */
  onEmail?: (mail: { to: string; subject: string; body: string }) => void | Promise<void>;
  people?: Omit<MockPerson, "removed">[];
}

export interface MockBroker {
  url: string;
  port: number;
  people: Map<string, MockPerson>;
  outbox: Array<{ to: string; subject: string; body: string }>;
  requests: Array<{ ref: string; profileId: string; email: string; status: "pending" | "completed"; token: string }>;
  options: MockBrokerOptions;
  regenerate(id: string): void;
  close(): Promise<void>;
}

export const DEFAULT_PEOPLE: Omit<MockPerson, "removed">[] = [
  {
    id: "p-1001",
    name: "John Example",
    city: "Boca Raton",
    state: "FL",
    age: 41,
    phone: "(555) 555-1234",
    email: "john@example.com",
    street: "123 Palm Tree Ave",
    relatives: ["Jane Example"],
  },
  {
    id: "p-1002",
    name: "John Example",
    city: "Portland",
    state: "OR",
    age: 67,
    phone: "(555) 201-9876",
    email: "jexample67@example.net",
    street: "9 Rose Ct",
    relatives: [],
  },
  {
    id: "p-2001",
    name: "Maria Sample",
    city: "Austin",
    state: "TX",
    age: 35,
    phone: "(555) 777-0100",
    email: "maria@example.org",
    street: "77 Oak Ln",
    relatives: [],
  },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${esc(title)} | ExampleBroker</title></head><body><h1>${esc(title)}</h1>${body}</body></html>`;

export function startMockBroker(options: MockBrokerOptions = {}): Promise<MockBroker> {
  const people = new Map<string, MockPerson>();
  for (const p of options.people ?? DEFAULT_PEOPLE) people.set(p.id, { ...p, removed: false });
  const outbox: MockBroker["outbox"] = [];
  const requests: MockBroker["requests"] = [];
  const csrfTokens = new Map<string, string>();
  let refCounter = 40000;
  let baseUrl = "";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: string, type = "text/html; charset=utf-8", headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    try {
      if (req.method === "GET" && url.pathname === "/search") {
        const name = (url.searchParams.get("name") ?? "").toLowerCase().trim();
        const state = (url.searchParams.get("state") ?? "").toUpperCase().trim();
        const hits = [...people.values()].filter(
          (p) => !p.removed && p.name.toLowerCase() === name && (!state || p.state === state),
        );
        const items = hits
          .map(
            (p) =>
              `<li class="result"><a class="profile-link" href="/profile/${p.id}">${esc(p.name)}</a> <span class="location">${esc(p.city)}, ${p.state}</span> <span class="age">Age ${p.age}</span></li>`,
          )
          .join("");
        return send(200, page("Search results", `<p>People search results</p><ul id="results">${items}</ul>`));
      }

      const profile = url.pathname.match(/^\/profile\/([\w-]+)$/);
      if (req.method === "GET" && profile) {
        const p = people.get(profile[1]!);
        if (!p || p.removed) return send(410, page("Record not available", "<p>This record is no longer available.</p>"));
        return send(
          200,
          page(
            p.name,
            `<div class="profile"><img class="profile-photo" src="/img/${p.id}.png" alt="photo">
             <p>Age ${p.age}</p><p>Current address: ${esc(p.street)}, ${esc(p.city)}, ${p.state}</p>
             <p>Phone: ${esc(p.phone)}</p><p>Email: ${esc(p.email)}</p>
             <p>Possible relatives: ${p.relatives.map(esc).join(", ") || "none listed"}</p></div>`,
          ),
        );
      }

      if (req.method === "GET" && url.pathname === "/optout") {
        const session = randomBytes(8).toString("hex");
        const csrf = randomBytes(12).toString("hex");
        csrfTokens.set(session, csrf);
        const captcha = options.captcha ? `<div class="g-recaptcha" data-sitekey="test-site-key"></div>` : "";
        return send(
          200,
          page(
            "Opt out",
            `<form id="optout-form" action="/optout" method="post">
               <input type="hidden" name="csrf" value="${csrf}">
               <label>Profile URL <input name="profile_url" type="url"></label>
               <label>Email <input name="email" type="email"></label>
               ${captcha}
               <button type="submit">Remove my information</button>
             </form>`,
          ),
          "text/html; charset=utf-8",
          { "set-cookie": `eb_session=${session}; Path=/; HttpOnly` },
        );
      }

      if (req.method === "POST" && url.pathname === "/optout") {
        const body = await readBody(req);
        const form = new URLSearchParams(body);
        const session = /eb_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
        if (!session || csrfTokens.get(session) !== form.get("csrf")) return send(403, page("Error", "<p>Invalid session.</p>"));
        if (options.captcha) return send(403, page("Error", `<div class="g-recaptcha" data-sitekey="x"></div>`));
        const profileUrl = form.get("profile_url") ?? "";
        const email = form.get("email") ?? "";
        const id = /\/profile\/([\w-]+)/.exec(profileUrl)?.[1];
        const p = id ? people.get(id) : undefined;
        if (!p || !/^[^@\s]+@[^@\s]+$/.test(email)) return send(400, page("Error", "<p>Please provide a valid profile URL and email.</p>"));
        const ref = `EB-${++refCounter}`;
        const token = randomBytes(10).toString("base64url");
        const reqRec = { ref, profileId: p.id, email, status: "pending" as const, token };
        requests.push(reqRec);
        if (options.requireEmailVerification ?? true) {
          const mail = {
            to: email,
            subject: "Confirm your ExampleBroker opt-out",
            body: `Click to confirm your opt-out request ${ref}: ${baseUrl}/optout/verify?token=${token}`,
          };
          outbox.push(mail);
          await options.onEmail?.(mail);
          return send(200, page("Request received", `<p>Your request has been received. Please check your email to confirm. Reference number: ${ref}</p>`));
        }
        p.removed = true;
        (reqRec as { status: string }).status = "completed";
        return send(200, page("Request received", `<p>Your request has been received. Reference number: ${ref}</p>`));
      }

      if (req.method === "GET" && url.pathname === "/optout/verify") {
        const r = requests.find((x) => x.token === url.searchParams.get("token"));
        if (!r) return send(404, page("Not found", "<p>Unknown confirmation link.</p>"));
        r.status = "completed";
        const p = people.get(r.profileId);
        if (p) p.removed = true;
        return send(200, page("Confirmed", `<p>Your opt-out request ${r.ref} is confirmed.</p>`));
      }

      if (req.method === "GET" && url.pathname === "/optout/status") {
        const r = requests.find((x) => x.ref === url.searchParams.get("ref"));
        return send(r ? 200 : 404, JSON.stringify({ ref: r?.ref ?? null, status: r?.status ?? "unknown" }), "application/json");
      }

      if (req.method === "GET" && url.pathname === "/") {
        return send(200, page("ExampleBroker", `<p>Find anyone. People search and public records.</p><a href="/optout">Privacy / opt out</a>`));
      }
      send(404, page("Not found", "<p>Not found</p>"));
    } catch (err) {
      send(500, page("Error", `<p>${esc(String(err))}</p>`));
    }
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        url: baseUrl,
        port: addr.port,
        people,
        outbox,
        requests,
        options,
        regenerate(id) {
          const p = people.get(id);
          if (p) p.removed = false;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 100_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// `tsx removal-agents/example-broker/mock-server.ts` runs it standalone.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.MOCK_BROKER_PORT ?? 4545);
  startMockBroker({ port, requireEmailVerification: process.env.MOCK_BROKER_EMAIL_VERIFY !== "false" }).then((b) =>
    console.log(`ExampleBroker mock listening on ${b.url}`),
  );
}
