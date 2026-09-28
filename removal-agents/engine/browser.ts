import { parse, type HTMLElement } from "node-html-parser";
import type { SafeFetchInit, SafeResponse } from "../../security/ssrf";
import { AutomationError } from "../../shared/errors";

/**
 * A deliberately simple, HTTP-level "browser" for public web forms. It keeps
 * cookies, parses HTML forms and submits them — nothing more. It does not run
 * JavaScript, solve challenges, rotate identities or evade bot detection.
 * When a site presents human verification, automation stops (spec §30).
 */

export interface HttpClient {
  request(url: string, init?: SafeFetchInit): Promise<SafeResponse>;
}

export class HumanVerificationRequired extends Error {
  constructor(public readonly url: string) {
    super("This website requires human verification");
    this.name = "HumanVerificationRequired";
  }
}

const CHALLENGE_MARKERS = [
  /class=["'][^"']*g-recaptcha/i,
  /class=["'][^"']*h-captcha/i,
  /class=["'][^"']*cf-turnstile/i,
  /challenges\.cloudflare\.com/i,
  /\/cdn-cgi\/challenge-platform\//i,
  /verify (that )?you are (a )?human/i,
  /are you a robot/i,
  /data-sitekey=/i,
];

export function detectHumanVerification(res: { status: number; body: string; headers: Record<string, string> }): boolean {
  if (res.headers["cf-mitigated"] === "challenge") return true;
  return CHALLENGE_MARKERS.some((re) => re.test(res.body));
}

export interface FormSnapshot {
  action: string;
  method: "GET" | "POST";
  fields: Record<string, string>;
  fieldNames: string[];
}

export class PageSession {
  cookies: Record<string, string>;
  url?: string;
  status?: number;
  html = "";
  private root?: HTMLElement;

  constructor(
    private readonly http: HttpClient,
    cookies: Record<string, string> = {},
  ) {
    this.cookies = { ...cookies };
  }

  async open(url: string, init: SafeFetchInit = {}): Promise<SafeResponse> {
    const cookieHeader = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const res = await this.http.request(url, {
      ...init,
      headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...init.headers },
    });
    this.captureCookies(res.headers["set-cookie"]);
    this.url = res.url;
    this.status = res.status;
    this.html = res.body;
    this.root = parse(res.body);
    if (detectHumanVerification(res)) throw new HumanVerificationRequired(res.url);
    if (res.status === 429) throw new AutomationError("Rate limited by the website", true, "RATE_LIMITED");
    if (res.status >= 500) throw new AutomationError(`Website returned ${res.status}`, true, "UPSTREAM_ERROR");
    return res;
  }

  text(): string {
    return this.root?.textContent.replace(/\s+/g, " ").trim() ?? "";
  }

  has(selector: string): boolean {
    return !!this.root?.querySelector(selector);
  }

  links(selector: string): Array<{ href: string; text: string }> {
    if (!this.root || !this.url) return [];
    return this.root.querySelectorAll(selector).map((a) => ({
      href: new URL(a.getAttribute("href") ?? "", this.url).toString(),
      text: a.textContent.trim(),
    }));
  }

  form(selector: string): FormSnapshot {
    const el = this.root?.querySelector(selector);
    if (!el || !this.url) throw new AutomationError(`Form ${selector} not found (the site layout may have changed)`, false, "LAYOUT_CHANGED");
    const fields: Record<string, string> = {};
    const names: string[] = [];
    for (const input of el.querySelectorAll("input, textarea, select")) {
      const name = input.getAttribute("name");
      if (!name) continue;
      names.push(name);
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if (input.hasAttribute("checked")) fields[name] = input.getAttribute("value") ?? "on";
        continue;
      }
      fields[name] = input.getAttribute("value") ?? "";
    }
    const method = (el.getAttribute("method") ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
    return { action: new URL(el.getAttribute("action") ?? this.url, this.url).toString(), method, fields, fieldNames: names };
  }

  async submit(form: FormSnapshot, values: Record<string, string>): Promise<SafeResponse> {
    for (const k of Object.keys(values)) {
      if (!form.fieldNames.includes(k)) throw new AutomationError(`Field "${k}" not present in form (layout changed?)`, false, "LAYOUT_CHANGED");
    }
    const body = new URLSearchParams({ ...form.fields, ...values }).toString();
    if (form.method === "GET") return this.open(`${form.action}${form.action.includes("?") ? "&" : "?"}${body}`);
    return this.open(form.action, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }

  private captureCookies(header: string | undefined) {
    if (!header) return;
    // Node joins multiple Set-Cookie headers with ", ". Split on commas that start a new cookie.
    for (const part of header.split(/,(?=\s*[^;,=\s]+=)/)) {
      const [pair] = part.trim().split(";");
      const idx = pair?.indexOf("=") ?? -1;
      if (pair && idx > 0) this.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
}
