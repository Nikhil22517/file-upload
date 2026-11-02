import { serve } from '@hono/node-server';
import { runMigrations } from '@platform/db';
import { app } from './app.ts';
import { config } from './config.ts';

await runMigrations();

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) =>
  console.info(`ingestion API on http://localhost:${info.port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}
