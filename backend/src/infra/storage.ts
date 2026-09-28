import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FieldCipher } from "../../../security/crypto";

/**
 * Object storage for short-lived, user-provided verification documents.
 * Files are encrypted before they touch disk (or a bucket) and deleted by the
 * retention sweeper. Swap LocalEncryptedStorage for an S3-compatible adapter
 * in production; the interface is intentionally tiny.
 */
export interface ObjectStorage {
  put(data: Buffer, aad: string): Promise<string>;
  get(key: string, aad: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalEncryptedStorage implements ObjectStorage {
  constructor(
    private readonly dir: string,
    private readonly cipher: FieldCipher,
  ) {}

  async put(data: Buffer, aad: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const key = randomUUID();
    await writeFile(path.join(this.dir, key), this.cipher.encrypt(data.toString("base64"), aad), { mode: 0o600 });
    return key;
  }

  async get(key: string, aad: string): Promise<Buffer> {
    this.assertKey(key);
    return Buffer.from(this.cipher.decrypt(await readFile(path.join(this.dir, key), "utf8"), aad), "base64");
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    await rm(path.join(this.dir, key), { force: true });
  }

  private assertKey(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid storage key");
  }
}
