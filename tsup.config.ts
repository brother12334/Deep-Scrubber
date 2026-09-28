import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "backend/src/main.ts",
    worker: "workers/src/main.ts",
    migrate: "database/migrate.ts",
    seed: "database/seed.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: true,
  // Keep runtime deps external; they are installed in the image.
  skipNodeModulesBundle: true,
});
