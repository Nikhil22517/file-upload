import { z } from 'zod';

// DATABASE_URL is read by @platform/db. Every process that serves uploads (the API, the web app) must
// point STORAGE_DIR at the same folder: a held file is read again when someone confirms it, possibly elsewhere.
const env = z.object({
  STORAGE_DIR: z.string().default('./data/files'), // stands in for S3/R2 until object storage is wired
  // originals are kept only until their rows are imported; 'true' keeps them (evidence, re-import)
  KEEP_FILES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // uploads by URL: comma-separated hosts the service may download from (e.g. your bucket); empty = any host
  FILE_URL_HOSTS: z.string().default('').transform((s) => s.split(',').map((h) => h.trim()).filter(Boolean)),
  MAX_FILE_MB: z.coerce.number().default(25),
  MAX_FILES_PER_UPLOAD: z.coerce.number().default(25),
}).parse(process.env);

export const config = env;
