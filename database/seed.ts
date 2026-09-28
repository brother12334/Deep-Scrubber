import { closeContext, createContext } from "../backend/src/context";
import { MemoryJobQueue } from "../backend/src/infra/queue";
import { seedRegistry } from "../backend/src/services/sources";
import { MemoryRateLimiter } from "../security/rate-limit";

/** Load the data-source registry and bundled workflows into the database. */
const ctx = createContext({ queue: new MemoryJobQueue(), rateLimiter: new MemoryRateLimiter() });
seedRegistry(ctx)
  .then((r) => console.log(`registry: ${r.sources} sources, ${r.workflows} new workflow version(s)`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeContext(ctx));
