import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCipher, parseKeyRing } from "../../security/crypto";
import { maskIdentifier } from "../../security/masking";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../../security/password";
import { MemoryRateLimiter } from "../../security/rate-limit";
import { defaultFetchPolicy, isBlockedAddress, resolvePublicAddress, safeFetch, UnsafeUrlError, validateUrl } from "../../security/ssrf";
import { totpAt, verifyTotp } from "../../security/totp";

const k = (s: string) => Buffer.from(s.padEnd(32, "x")).toString("base64");

describe("field encryption", () => {
  const ring = parseKeyRing(`v1:${k("one")},v2:${k("two")}`, "v2");
  const cipher = new FieldCipher(ring, Buffer.from(k("blind"), "base64"));

  it("round-trips and binds ciphertext to its context (AAD)", () => {
    const ct = cipher.encrypt("john@example.com", "identifier:p1");
    expect(ct.startsWith("v2.")).toBe(true);
    expect(cipher.decrypt(ct, "identifier:p1")).toBe("john@example.com");
    expect(() => cipher.decrypt(ct, "identifier:p2")).toThrow();
  });
  it("uses random IVs and supports rotation", () => {
    expect(cipher.encrypt("x", "a")).not.toBe(cipher.encrypt("x", "a"));
    const old = new FieldCipher(parseKeyRing(`v1:${k("one")}`, "v1"), Buffer.from(k("blind"), "base64"));
    const legacy = old.encrypt("secret", "ctx");
    expect(cipher.needsRotation(legacy)).toBe(true);
    expect(cipher.decrypt(legacy, "ctx")).toBe("secret");
  });
  it("produces stable, domain-separated blind indexes", () => {
    expect(cipher.blindIndex("a", "x")).toBe(cipher.blindIndex("a", "x"));
    expect(cipher.blindIndex("a", "x")).not.toBe(cipher.blindIndex("a", "y"));
  });
  it("rejects malformed key rings", () => {
    expect(() => parseKeyRing("v1:short", "v1")).toThrow();
    expect(() => parseKeyRing(`v1:${k("a")}`, "v9")).toThrow();
  });
});

describe("passwords, masking, TOTP", () => {
  it("hashes and verifies with scrypt", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(validatePasswordPolicy("short")).toBeTruthy();
  });
  it("masks sensitive identifiers", () => {
    expect(maskIdentifier("PHONE", "(555) 555-1242")).toBe("••••••••42");
    expect(maskIdentifier("EMAIL", "john@example.com")).toMatch(/^j•+@example\.com$/);
    expect(maskIdentifier("ALIAS", "Johnny")).toBe("[Hidden]");
  });
  it("verifies RFC 6238 codes with drift tolerance", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, t - 30_000), t)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, t - 120_000), t)).toBe(false);
  });
});

describe("SSRF protection", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00:ec2::254",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it("allows public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it.each([
    "file:///etc/passwd",
    "gopher://x.com",
    "http://user:pass@example.com",
    "http://localhost/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://example.com:22/",
    "http://intranet/",
  ])("rejects %s", (url) => expect(() => validateUrl(url)).toThrow(UnsafeUrlError));

  it("rejects hostnames that resolve to private addresses (DNS validation)", async () => {
    const resolver = async () => [{ address: "10.0.0.5", family: 4 }];
    await expect(resolvePublicAddress("evil.example", defaultFetchPolicy, resolver)).rejects.toThrow(/private/);
    const mixed = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(resolvePublicAddress("rebind.example", defaultFetchPolicy, mixed)).rejects.toThrow();
  });

  describe("safeFetch against a local server", () => {
    let server: http.Server;
    let port = 0;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === "/redirect-internal") {
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          return res.end();
        }
        if (req.url === "/big") {
          res.writeHead(200, { "content-type": "text/html" });
          return res.end("x".repeat(5000));
        }
        if (req.url === "/binary") {
          res.writeHead(200, { "content-type": "application/octet-stream" });
          return res.end("bin");
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<p>ok</p>");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      port = (server.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    const policy = () => ({ ...defaultFetchPolicy, privateHostAllowlist: ["127.0.0.1"], maxBytes: 1000 });

    it("fetches allow-listed dev hosts", async () => {
      const r = await safeFetch(`http://127.0.0.1:${port}/`, {}, policy());
      expect(r.body).toContain("ok");
    });
    it("refuses the same host without the allow-list", async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, defaultFetchPolicy)).rejects.toThrow(UnsafeUrlError);
    });
    it("re-validates every redirect hop", async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/redirect-internal`, {}, policy())).rejects.toThrow(UnsafeUrlError);
    });
    it("caps response size and content types", async () => {
      const r = await safeFetch(`http://127.0.0.1:${port}/big`, {}, policy());
      expect(r.truncated).toBe(true);
      expect(r.body.length).toBeLessThanOrEqual(1000);
      await expect(safeFetch(`http://127.0.0.1:${port}/binary`, {}, policy())).rejects.toThrow(/Content type/);
    });
  });
});

describe("rate limiting", () => {
  it("enforces a fixed window", async () => {
    const rl = new MemoryRateLimiter();
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rl.hit("k", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });
});
