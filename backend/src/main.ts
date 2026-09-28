import { closeContext, createContext } from "./context";
import { buildApp } from "./http/app";

const ctx = createContext();

buildApp(ctx)
  .then(async (app) => {
    await app.listen({ host: ctx.cfg.API_HOST, port: ctx.cfg.API_PORT });
    ctx.log.info({ port: ctx.cfg.API_PORT }, "API listening");
    const shutdown = async (signal: string) => {
      ctx.log.info({ signal }, "API shutting down");
      await app.close();
      await closeContext(ctx);
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
  })
  .catch((err) => {
    ctx.log.error({ err: String(err) }, "failed to start API");
    process.exit(1);
  });
