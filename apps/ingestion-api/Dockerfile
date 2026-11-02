# Build context: the monorepo root (see docker-compose.yml).
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

# manifests first, so code changes don't reinstall dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/db/package.json packages/db/
COPY packages/ingestion-service/package.json packages/ingestion-service/
COPY apps/ingestion-api/package.json apps/ingestion-api/
RUN pnpm install --frozen-lockfile --filter "@platform/ingestion-api..."

COPY packages/ingestion packages/ingestion
COPY packages/db packages/db
COPY packages/ingestion-service packages/ingestion-service
COPY apps/ingestion-api apps/ingestion-api

WORKDIR /repo/apps/ingestion-api
EXPOSE 8000
# tsx runs the TypeScript directly (workspace packages are consumed as source)
CMD ["pnpm", "start"]
