import { config as service } from '@platform/ingestion-service';
import { z } from 'zod';

// Upload settings (STORAGE_DIR, KEEP_FILES, ...) belong to @platform/ingestion-service; the API adds its port.
export const config = { ...service, PORT: z.coerce.number().default(8000).parse(process.env.PORT) };
