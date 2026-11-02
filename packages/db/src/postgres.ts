import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.ts';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://lmd:lmd@localhost:5432/lmd',
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });
export type Db = typeof db;

const MIGRATION_LOCK = 774_211; // shared by every process that migrates

/** The drizzle migrations folder. Found next to this file when it runs from source (the API, tests, `vite dev`);
 *  a bundled build (the web app's `vite build`) moves this code away from it, so it sets MIGRATIONS_DIR. */
const migrationsFolder = () => process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../drizzle', import.meta.url));

/** Apply pending migrations. Every process that serves the database calls this at startup (the API) or on its
 *  first request (the web app), so an advisory lock makes them take turns (two processes creating an extension at once fails). */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(drizzle(client, { casing: 'snake_case' }), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    client.release();
  }
}
