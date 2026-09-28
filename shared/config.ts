import { z } from "zod";
import { loadDotEnv } from "./env";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().default(4000),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_APP_URL: z.string().url().default("http://localhost:3001"),
  /** Comma-separated list of origins allowed to call the API with credentials. */
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  TRUST_PROXY: bool.default(false),

  DATABASE_URL: z.string().default("postgres://postgres@127.0.0.1:5432/deepscrubber"),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** "bullmq" in production; "memory" runs jobs in-process (tests / single-node dev). */
  QUEUE_DRIVER: z.enum(["bullmq", "memory"]).default("bullmq"),
  /** "redis" or "memory" for rate limiting. */
  RATE_LIMIT_DRIVER: z.enum(["redis", "memory"]).default("redis"),

  /** Key ring: "v1:<base64 32 bytes>,v2:<base64 32 bytes>". */
  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  /** Separate key for deterministic blind indexes (HMAC-SHA256). */
  BLIND_INDEX_KEY: z.string().min(1),
  /** Key used to pseudonymise IPs in logs/audit records. */
  LOG_HASH_KEY: z.string().min(1),

  SESSION_TTL_HOURS: z.coerce.number().int().default(24 * 14),
  COOKIE_SECURE: bool.default(false),
  COOKIE_DOMAIN: z.string().optional(),
  ADMIN_REQUIRE_MFA: bool.default(true),
  REQUIRE_EMAIL_VERIFICATION: bool.default(true),

  // Search providers (authorized APIs only).
  SEARCH_PROVIDERS: z.string().default("fixture"),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_CSE_API_KEY: z.string().optional(),
  GOOGLE_CSE_ID: z.string().optional(),
  SEARCH_FIXTURE_FILE: z.string().optional(),

  // AI provider abstraction.
  AI_PROVIDER: z.enum(["anthropic", "none"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5"),

  // Outbound mail.
  MAIL_TRANSPORT: z.enum(["smtp", "log"]).default("log"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Deep Scrubber <no-reply@deepscrubber.local>"),
  /** Address used as Reply-To on removal emails sent on a user's behalf. */
  REMOVAL_REPLY_TO_DOMAIN: z.string().default("requests.deepscrubber.local"),

  /** HMAC secret shared with the inbound-mail provider for relay aliases. */
  INBOUND_EMAIL_SECRET: z.string().optional(),

  /** "dev" lets users switch plans without payment (never in production). "stripe" is a placeholder adapter. */
  BILLING_MODE: z.enum(["dev", "disabled"]).default("disabled"),

  // Web push (optional).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:privacy@deepscrubber.local"),

  // Outbound fetch safety.
  FETCH_TIMEOUT_MS: z.coerce.number().int().default(10000),
  FETCH_MAX_BYTES: z.coerce.number().int().default(2_000_000),
  FETCH_ALLOWED_PORTS: z.string().default("80,443"),
  /** Hostnames exempt from private-IP filtering (dev only, e.g. the mock broker). */
  FETCH_ALLOWLIST_PRIVATE_HOSTS: z.string().default(""),
  USER_AGENT: z.string().default("DeepScrubberPrivacyBot/0.1 (+https://deepscrubber.local/bot)"),

  EXAMPLE_BROKER_BASE_URL: z.string().default("http://127.0.0.1:4545"),

  // Retention.
  TEMP_DOCUMENT_TTL_HOURS: z.coerce.number().int().default(24),
  DEFAULT_RECORD_RETENTION_DAYS: z.coerce.number().int().default(365),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().default(400),
  STORAGE_DIR: z.string().default("./var/storage"),

  // Provider health.
  PROVIDER_FAILURE_THRESHOLD: z.coerce.number().default(0.25),
  PROVIDER_MIN_SAMPLES: z.coerce.number().int().default(8),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (!parsed.data.COOKIE_SECURE) throw new Error("COOKIE_SECURE must be true in production");
    if (parsed.data.BILLING_MODE === "dev") throw new Error("BILLING_MODE=dev is not allowed in production");
    if (parsed.data.FETCH_ALLOWLIST_PRIVATE_HOSTS) {
      throw new Error("FETCH_ALLOWLIST_PRIVATE_HOSTS must be empty in production");
    }
  }
  return parsed.data;
}

export function config(): AppConfig {
  if (!cached) loadDotEnv();
  cached ??= loadConfig();
  return cached;
}

/** Test hook: replace the process-wide config. */
export function setConfig(next: AppConfig): void {
  cached = next;
}
