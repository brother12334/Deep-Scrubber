import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field-level encryption for sensitive identifiers.
 *
 * - AES-256-GCM with a random 96-bit IV per value.
 * - Versioned key ring so keys can be rotated without downtime:
 *   ciphertext = "<keyId>.<iv>.<tag>.<ciphertext>" (base64url parts).
 * - Additional authenticated data (AAD) binds a ciphertext to its context
 *   (e.g. "identifier:<profileId>") so values cannot be swapped between rows
 *   or tenants by someone with database write access.
 *
 * Blind indexes (HMAC-SHA256 under a separate key) allow equality lookups and
 * de-duplication without storing plaintext.
 */

export interface KeyRing {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

export function parseKeyRing(spec: string, activeKeyId: string): KeyRing {
  const keys = new Map<string, Buffer>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx <= 0) throw new Error("Malformed ENCRYPTION_KEYS entry (expected id:base64)");
    const id = part.slice(0, idx);
    if (!/^[a-zA-Z0-9_-]{1,16}$/.test(id)) throw new Error(`Invalid key id "${id}"`);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (key.length !== 32) throw new Error(`Key "${id}" must decode to 32 bytes`);
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new Error(`Active key "${activeKeyId}" not present in key ring`);
  return { activeKeyId, keys };
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export class FieldCipher {
  constructor(
    private readonly ring: KeyRing,
    private readonly blindIndexKey: Buffer,
  ) {
    if (blindIndexKey.length < 32) throw new Error("BLIND_INDEX_KEY must be at least 32 bytes");
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.ring.keys.get(this.ring.activeKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [this.ring.activeKeyId, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
  }

  decrypt(payload: string, aad: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4) throw new Error("Malformed ciphertext");
    const [keyId, iv, tag, ct] = parts as [string, string, string, string];
    const key = this.ring.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
    const decipher = createDecipheriv("aes-256-gcm", key, fromB64u(iv));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(fromB64u(tag));
    return Buffer.concat([decipher.update(fromB64u(ct)), decipher.final()]).toString("utf8");
  }

  encryptJson(value: unknown, aad: string): string {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T>(payload: string, aad: string): T {
    return JSON.parse(this.decrypt(payload, aad)) as T;
  }

  /** True when the ciphertext was produced with a key other than the active one. */
  needsRotation(payload: string): boolean {
    return payload.split(".", 1)[0] !== this.ring.activeKeyId;
  }

  /** Deterministic, keyed index of an already-normalized value. */
  blindIndex(normalized: string, domain: string): string {
    return createHmac("sha256", this.blindIndexKey).update(`${domain}\u0000${normalized}`).digest("hex");
  }
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Keyed pseudonymisation for values that appear in logs (IPs, user agents). */
export function pseudonymize(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 24);
}

let cipherSingleton: FieldCipher | undefined;

export function getCipher(cfg: { ENCRYPTION_KEYS: string; ENCRYPTION_ACTIVE_KEY_ID: string; BLIND_INDEX_KEY: string }): FieldCipher {
  cipherSingleton ??= new FieldCipher(
    parseKeyRing(cfg.ENCRYPTION_KEYS, cfg.ENCRYPTION_ACTIVE_KEY_ID),
    Buffer.from(cfg.BLIND_INDEX_KEY, "base64"),
  );
  return cipherSingleton;
}

export function resetCipherForTests(): void {
  cipherSingleton = undefined;
}
