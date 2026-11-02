/**
 * Push a folder of sample reports through the running API and print what happened.
 *
 *     pnpm upload-folder "C:\Users\NikhilSharma\Downloads\DSP Reports"
 *
 * Sub-folders map to workspaces by name (edit FOLDER_WORKSPACE for other folders).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:8000';
const FOLDER_WORKSPACE: Record<string, string> = {
  'Daily Reports': 'PTLG', 'Weekly Reports': 'PTLG', 'paya daily': 'PAYA', 'paya weekly': 'PAYA',
};

async function api<T = any>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + p, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const root = process.argv[2];
if (!root) throw new Error('usage: pnpm upload-folder <folder>');
await api('/health');
const existing = new Map((await api<any[]>('/workspaces')).map((w) => [w.code, w]));
const ws: Record<string, any> = {};
for (const code of new Set(Object.values(FOLDER_WORKSPACE))) {
  ws[code] = existing.get(code) ?? await api('/workspaces', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: `Client ${code}` }),
  });
}

const uploaded: [string, any][] = [];
for (const [sub, code] of Object.entries(FOLDER_WORKSPACE)) {
  const folder = path.join(root, sub);
  if (!(await stat(folder).catch(() => null))?.isDirectory()) continue;
  const form = new FormData();
  for (const name of (await readdir(folder)).sort()) {
    form.append('files', new Blob([await readFile(path.join(folder, name))]), name);
  }
  const res = await api<any[]>(`/workspaces/${ws[code].id}/files`, { method: 'POST', body: form });
  uploaded.push(...res.map((r): [string, any] => [code, r]));
}

console.log('ws   | file                                           | template                    | stage                | notes');
for (const [code, r] of uploaded) {
  const notes = r.error ?? (r.warnings ?? []).map((w: any) => w.message).join('; ');
  console.log(`${code.padEnd(4)} | ${r.fileName.slice(0, 46).padEnd(46)} | ${String(r.template?.name ?? '-').slice(0, 27).padEnd(27)} | `
    + `${r.stage.padEnd(20)} | ${notes}`);
}
