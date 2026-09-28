import { Redis } from "ioredis";
import { createLLMProvider, type LLMProvider } from "../../ai";
import { Database } from "../../database/db";
import { createSearchProviders, type SearchProvider } from "../../providers/search";
import { createAgentRegistry } from "../../removal-agents/registry";
import type { RemovalAgent } from "../../removal-agents/types";
import { getCipher, type FieldCipher } from "../../security/crypto";
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from "../../security/rate-limit";
import { policyFromConfig, type FetchPolicy } from "../../security/ssrf";
import { config, type AppConfig } from "../../shared/config";
import { createLogger, type Logger } from "../../shared/logger";
import { SafeHttpClient } from "./infra/http-client";
import { LogMailer, SmtpMailer, type Mailer } from "./infra/mailer";
import { BullJobQueue, MemoryJobQueue, type JobQueue } from "./infra/queue";
import { LocalEncryptedStorage, type ObjectStorage } from "./infra/storage";

export interface Clock {
  now(): Date;
}

/** Everything a request handler or job needs. Built once per process. */
export interface AppContext {
  cfg: AppConfig;
  db: Database;
  cipher: FieldCipher;
  queue: JobQueue;
  rateLimiter: RateLimiter;
  llm: LLMProvider;
  searchProviders: SearchProvider[];
  agents: Map<string, RemovalAgent>;
  mailer: Mailer;
  http: SafeHttpClient;
  fetchPolicy: FetchPolicy;
  storage: ObjectStorage;
  log: Logger;
  clock: Clock;
  redis?: Redis;
}

export function createContext(overrides: Partial<AppContext> = {}): AppContext {
  const cfg = overrides.cfg ?? config();
  const log = overrides.log ?? createLogger("deep-scrubber");
  const cipher = overrides.cipher ?? getCipher(cfg);
  const clock = overrides.clock ?? { now: () => new Date() };
  const needsRedis = (!overrides.queue && cfg.QUEUE_DRIVER === "bullmq") || (!overrides.rateLimiter && cfg.RATE_LIMIT_DRIVER === "redis");
  const redis = overrides.redis ?? (needsRedis ? new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null }) : undefined);
  const fetchPolicy = overrides.fetchPolicy ?? policyFromConfig(cfg);
  return {
    cfg,
    log,
    cipher,
    clock,
    redis,
    fetchPolicy,
    db: overrides.db ?? new Database(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX),
    queue: overrides.queue ?? (cfg.QUEUE_DRIVER === "bullmq" ? new BullJobQueue(redis!) : new MemoryJobQueue(() => clock.now().getTime())),
    rateLimiter: overrides.rateLimiter ?? (cfg.RATE_LIMIT_DRIVER === "redis" ? new RedisRateLimiter(redis!) : new MemoryRateLimiter()),
    llm: overrides.llm ?? createLLMProvider(cfg, (task, err) => log.warn({ task, err: String(err) }, "ai task failed; using fallback")),
    searchProviders: overrides.searchProviders ?? createSearchProviders(cfg),
    agents: overrides.agents ?? createAgentRegistry(),
    mailer:
      overrides.mailer ??
      (cfg.MAIL_TRANSPORT === "smtp" && cfg.SMTP_URL ? new SmtpMailer(cfg.SMTP_URL, cfg.MAIL_FROM) : new LogMailer((m) => log.info(m))),
    http: overrides.http ?? new SafeHttpClient(fetchPolicy),
    storage: overrides.storage ?? new LocalEncryptedStorage(cfg.STORAGE_DIR, cipher),
  };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await ctx.queue.close();
  await ctx.db.close();
  ctx.redis?.disconnect();
}
