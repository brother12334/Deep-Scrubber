# Backend image: API, worker, migrations and maintenance scripts share one build.
# docker build -t deep-scrubber-backend .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY shared shared
COPY core core
COPY security security
COPY database database
COPY providers providers
COPY removal-agents removal-agents
COPY ai ai
COPY backend backend
COPY workers workers
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/database/migrations \
    REGISTRY_DIR=/app/providers/registry
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/package.json package.json
COPY database/migrations database/migrations
COPY providers/registry providers/registry
USER app
EXPOSE 4000
# Override the command for the worker: ["node", "dist/worker.js"]
CMD ["node", "dist/api.js"]
