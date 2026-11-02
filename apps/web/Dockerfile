# Build context: the monorepo root (see apps/ingestion-api/docker-compose.yml, service "web").
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

# manifests first, so code changes don't reinstall dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/db/package.json packages/db/
COPY packages/ingestion-service/package.json packages/ingestion-service/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@platform/web..."

COPY packages/ingestion packages/ingestion
COPY packages/db packages/db
COPY packages/ingestion-service packages/ingestion-service
COPY apps/web apps/web

WORKDIR /repo/apps/web
RUN pnpm build
ENV NODE_ENV=production PORT=3000 MIGRATIONS_DIR=/repo/packages/db/drizzle
EXPOSE 3000
CMD ["pnpm", "start"]
