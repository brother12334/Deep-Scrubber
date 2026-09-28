import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

/**
 * SSRF-hardened outbound HTTP client (spec §31).
 *
 * Every outbound request made on behalf of a scan, an agent or a user-supplied
 * URL goes through `safeFetch`, which enforces:
 *   - http/https only, no embedded credentials, allow-listed ports
 *   - hostname and DNS validation: every resolved address must be public
 *   - DNS pinning: the socket connects to the address we validated, which
 *     defeats DNS-rebinding between check and use
 *   - manual redirect handling with re-validation of every hop
 *   - connect/overall timeouts, response size cap, content-type allow list
 *   - per-host request budgets (crawl limits)
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const blocked = new BlockList();
// IPv4 special-purpose ranges (RFC 6890 and friends).
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  // IPv4-mapped (::ffff:0:0/96) is intentionally absent: Node's BlockList would then match
  // every IPv4 address. Mapped addresses are unwrapped and checked against the v4 list.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7], // unique local (incl. fd00:ec2::254 metadata)
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    return blocked.check(lower, "ipv6");
  }
  return true; // not an IP at all → refuse
}

export interface FetchPolicy {
  allowedPorts: number[];
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
  /** Hostnames exempt from private-address filtering (development only). */
  privateHostAllowlist: string[];
  allowedContentTypes: string[];
}

export const defaultFetchPolicy: FetchPolicy = {
  allowedPorts: [80, 443],
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  maxRedirects: 3,
  userAgent: "DeepScrubberPrivacyBot/0.1",
  privateHostAllowlist: [],
  allowedContentTypes: ["text/html", "text/plain", "application/json", "application/xhtml+xml", "application/xml", "text/xml"],
};

export function validateUrl(raw: string, policy: FetchPolicy = defaultFetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowlisted = policy.privateHostAllowlist.includes(host);
  if (!policy.allowedPorts.includes(port) && !allowlisted) throw new UnsafeUrlError(`Port ${port} is not allowed`);
  if (!allowlisted) {
    if (!host || BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new UnsafeUrlError("Host is not allowed");
    }
    if (isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError("Private or reserved addresses are not allowed");
    // Reject decimal/octal/hex IPv4 shorthands that some resolvers accept.
    if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) throw new UnsafeUrlError("Numeric host encodings are not allowed");
    if (!isIP(host) && !host.includes(".")) throw new UnsafeUrlError("Single-label hostnames are not allowed");
  }
  return url;
}

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Resolve a hostname and require every address to be public. Returns the pinned address. */
export async function resolvePublicAddress(
  host: string,
  policy: FetchPolicy,
  resolver: Resolver = systemResolver,
): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isBlockedAddress(bare) && !policy.privateHostAllowlist.includes(bare)) {
      throw new UnsafeUrlError("Private or reserved addresses are not allowed");
    }
    return { address: bare, family: isIP(bare) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(bare);
  } catch {
    throw new UnsafeUrlError("DNS resolution failed");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("DNS returned no addresses");
  if (!policy.privateHostAllowlist.includes(bare.toLowerCase())) {
    for (const a of addresses) {
      if (isBlockedAddress(a.address)) throw new UnsafeUrlError("Host resolves to a private or reserved address");
    }
  }
  return addresses[0]!;
}

export interface SafeFetchInit {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Skip the content-type allow list (used for HEAD checks). */
  anyContentType?: boolean;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  redirects: string[];
}

export class HostBudget {
  private readonly counts = new Map<string, number>();
  constructor(private readonly perHost: number) {}
  consume(host: string): void {
    const n = (this.counts.get(host) ?? 0) + 1;
    if (n > this.perHost) throw new UnsafeUrlError(`Crawl limit reached for ${host}`);
    this.counts.set(host, n);
  }
}

export async function safeFetch(
  rawUrl: string,
  init: SafeFetchInit = {},
  policy: FetchPolicy = defaultFetchPolicy,
  opts: { resolver?: Resolver; budget?: HostBudget } = {},
): Promise<SafeResponse> {
  const redirects: string[] = [];
  let current = rawUrl;
  let method = init.method ?? "GET";
  let body = init.body;
  const deadline = Date.now() + policy.timeoutMs;

  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    const url = validateUrl(current, policy);
    opts.budget?.consume(url.hostname);
    const pinned = await resolvePublicAddress(url.hostname, policy, opts.resolver);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeUrlError("Request timed out");

    const res = await requestOnce(url, pinned, { ...init, method, body }, policy, remaining);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      const next = new URL(res.headers.location, url).toString();
      redirects.push(next);
      current = next;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    if (!init.anyContentType && method !== "HEAD" && res.body.length > 0) {
      const ct = (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (ct && !policy.allowedContentTypes.includes(ct)) throw new UnsafeUrlError(`Content type ${ct} is not allowed`);
    }
    return { ...res, url: url.toString(), redirects };
  }
  throw new UnsafeUrlError("Too many redirects");
}

function requestOnce(
  url: URL,
  pinned: { address: string; family: number },
  init: SafeFetchInit,
  policy: FetchPolicy,
  timeoutMs: number,
): Promise<Omit<SafeResponse, "url" | "redirects">> {
  const lib = url.protocol === "https:" ? https : http;
  // Pin the connection to the validated address; TLS still verifies the hostname.
  const lookup: LookupFunction = (_host, options, cb) => {
    if (typeof options === "object" && options && "all" in options && options.all) {
      (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [pinned]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: init.method ?? "GET",
        lookup,
        headers: {
          "user-agent": policy.userAgent,
          accept: "text/html,application/json;q=0.9,*/*;q=0.5",
          ...(init.body ? { "content-length": Buffer.byteLength(init.body).toString() } : {}),
          ...init.headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > policy.maxBytes) {
            truncated = true;
            const keep = chunk.subarray(0, chunk.length - (size - policy.maxBytes));
            if (keep.length) chunks.push(keep);
            res.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
          }
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
        };
        res.on("end", finish);
        res.on("error", (e) => (done ? undefined : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new UnsafeUrlError("Request timed out")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export function policyFromConfig(cfg: {
  FETCH_ALLOWED_PORTS: string;
  FETCH_TIMEOUT_MS: number;
  FETCH_MAX_BYTES: number;
  USER_AGENT: string;
  FETCH_ALLOWLIST_PRIVATE_HOSTS: string;
}): FetchPolicy {
  return {
    ...defaultFetchPolicy,
    allowedPorts: cfg.FETCH_ALLOWED_PORTS.split(",").map((p) => Number(p.trim())).filter(Boolean),
    timeoutMs: cfg.FETCH_TIMEOUT_MS,
    maxBytes: cfg.FETCH_MAX_BYTES,
    userAgent: cfg.USER_AGENT,
    privateHostAllowlist: cfg.FETCH_ALLOWLIST_PRIVATE_HOSTS.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}
