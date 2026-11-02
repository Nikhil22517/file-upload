/** Where an upload's original comes from when it is read again (held files are read once the user answers):
 *  the caller's own URL, or a local copy kept only until the import. A local folder stands in for S3/R2. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';

export async function saveFile(workspaceId: string, fileId: string, ext: string, data: Buffer): Promise<string> {
  const key = `${workspaceId}/raw/${fileId}${ext}`;
  const full = path.join(config.STORAGE_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export const deleteFile = (key: string): Promise<void> => rm(path.join(config.STORAGE_DIR, key), { force: true });

/** Download a file the caller stored. Only http(s); FILE_URL_HOSTS, when set, limits which hosts the API will call. */
export async function fetchUrl(url: string): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only http(s) URLs can be read');
  if (config.FILE_URL_HOSTS.length && !config.FILE_URL_HOSTS.includes(u.hostname)) throw new Error(`host ${u.hostname} is not allowed`);
  const limit = config.MAX_FILE_MB * 1024 * 1024;
  const res = await fetch(u, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new Error(`file exceeds the ${config.MAX_FILE_MB} MB limit`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length > limit) throw new Error(`file exceeds the ${config.MAX_FILE_MB} MB limit`);
  return b;
}

/** The original of an upload: from its URL, else from the local copy. */
export function readOriginal(f: { fileUrl: string | null; storageKey: string | null }): Promise<Buffer> {
  if (f.fileUrl) return fetchUrl(f.fileUrl);
  if (f.storageKey) return readFile(path.join(config.STORAGE_DIR, f.storageKey));
  throw new Error('the original file was deleted after its import');
}

/** 'https://bucket.s3.amazonaws.com/reports/Quality_Overview_PTLG_DNJ4_2026-07-01.csv?X-Amz-...' -> the file name. */
export const fileNameFromUrl = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '') || 'file';
