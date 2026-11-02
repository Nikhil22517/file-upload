/** Upload, recognise, confirm and inspect report files. A file that passes the checks is imported
 *  right away: its rows go to report_row and the file ends at 'imported'. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { db, reportFile, reportRow, reportTemplate } from '@platform/db';
import {
  type Detection, type Format, type TemplateDraft, detect, draftTemplate, formatWeek, matchTemplate, parseFileName, parseWeek, readTable,
} from '@platform/ingestion';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from './config.ts';
import { fail, isUuid } from './errors.ts';
import { importFile } from './importer.ts';
import {
  ACTIVE_STAGES, type FileRow, type TemplateRow, type Tx, type Warning, changedWarning, stageOf, updateTemplateFromFile,
} from './stages.ts';
import { fetchUrl, fileNameFromUrl, readOriginal, saveFile } from './storage.ts';
import type { Workspace } from './workspaces.ts';

/** Guardrails (PRD F-PERF-1.2): warnings must be confirmed; nothing is silently dropped. */
async function guardrails(tx: Tx, ws: Workspace, d: Detection): Promise<Warning[]> {
  const warnings: Warning[] = [];
  const [dup] = await tx.select({ id: reportFile.id }).from(reportFile)
    .where(and(eq(reportFile.workspaceId, ws.id), eq(reportFile.sha256, d.sha256), inArray(reportFile.stage, ACTIVE_STAGES)))
    .limit(1);
  if (dup) warnings.push({ code: 'duplicate', message: 'This exact file was already uploaded.' });
  if (d.context.dsp && d.context.dsp !== ws.code) {
    const where = d.context.station ? `${d.context.dsp}/${d.context.station}` : d.context.dsp;
    warnings.push({ code: 'foreign_dsp', message: `This export is for DSP ${where} - not yours (${ws.code}).` });
  }
  return warnings;
}

/** What a file is: a template this workspace configured, matched by its columns (and file name), or nothing yet
 *  (the user teaches a template). There are no built-in report types. */
function recognise(d: Detection, pattern: string, templates: TemplateRow[]) {
  const m = matchTemplate(d.grid, d.format, pattern, templates);
  if (!m) return { template: null, headerRow: d.headerRow, warning: null };
  return { template: m.template, headerRow: m.headerRow, warning: m.kind === 'changed' ? changedWarning(m.template, m.added, m.missing) : null };
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK = /^\d{4}-W\d{1,2}$/;
const normWeek = (w: string | null | undefined) => { const p = parseWeek(w); return p ? formatWeek(p.year, p.week) : null; };

/** One file to take in: uploaded bytes, or a URL where the caller stored it. */
export interface Incoming { name: string; url: string | null; read: () => Promise<Buffer> }

export const fromFile = (f: File): Incoming => ({ name: f.name, url: null, read: async () => Buffer.from(await f.arrayBuffer()) });

export const UrlUploadInput = z.object({
  files: z.array(z.object({
    url: z.string().url(),                   // where you stored the file (S3, ...); it is downloaded, no copy is kept
    file_name: z.string().min(1).optional(), // defaults to the last part of the URL path
  })).min(1),
  reference_date: z.string().regex(DATE).optional(),
  reference_week: z.string().regex(WEEK).optional(),
});
export const fromUrls = (files: z.infer<typeof UrlUploadInput>['files']): Incoming[] =>
  files.map((f) => ({ name: f.file_name ?? fileNameFromUrl(f.url), url: f.url, read: () => fetchUrl(f.url) }));

export interface UploadResult {
  id?: string;
  fileName: string;
  url: string | null;
  stage: string;
  error?: string;
  template?: { id: string; name: string } | null;
  context?: FileRow['context'];
  referenceDate?: string | null;
  referenceWeek?: string | null;
  rowCount?: number | null;
  issueCount?: number | null;
  warnings?: Warning[];
  draft?: TemplateDraft;                     // an unknown report comes back with its guessed template
}

/** The period an uploader can give for the whole upload: a day for daily reports, a week for weekly ones.
 *  Each file uses the one its template needs (and only when its rows and name don't already say). */
export interface UploadPeriod { referenceDate?: string | null; referenceWeek?: string | null }

export async function uploadFiles(ws: Workspace, items: Incoming[], period: UploadPeriod = {}): Promise<UploadResult[]> {
  if (items.length < 1 || items.length > config.MAX_FILES_PER_UPLOAD) {
    fail(422, `Upload between 1 and ${config.MAX_FILES_PER_UPLOAD} files`);
  }
  if (period.referenceDate && !DATE.test(period.referenceDate)) fail(422, 'reference_date must be YYYY-MM-DD');
  if (period.referenceWeek && !WEEK.test(period.referenceWeek)) fail(422, 'reference_week must be YYYY-Www, e.g. 2026-W27');
  const templates = await db.select().from(reportTemplate).where(eq(reportTemplate.workspaceId, ws.id));

  const results: UploadResult[] = [];
  for (const up of items) {
    let data: Buffer;
    try {
      data = await up.read();
    } catch (e) {
      results.push({ fileName: up.name, url: up.url, stage: 'rejected', error: `Could not download the file: ${(e as Error).message}` });
      continue;
    }
    if (data.length > config.MAX_FILE_MB * 1024 * 1024) {
      results.push({ fileName: up.name, url: up.url, stage: 'rejected', error: `File exceeds the ${config.MAX_FILE_MB} MB limit` });
      continue;
    }
    let d: Detection;
    try {
      d = await detect(data, up.name);
    } catch (e) { // an unreadable file is a refusal with a reason
      results.push({ fileName: up.name, url: up.url, stage: 'rejected', error: `Could not read the file: ${(e as Error).message}` });
      continue;
    }
    const id = randomUUID();
    // a file sent by URL stays where the caller put it; an uploaded one is kept here until its import
    const key = up.url ? null : await saveFile(ws.id, id, path.extname(up.name).toLowerCase(), data);
    const fn = parseFileName(up.name, ws.code);
    const r = recognise(d, fn.pattern, templates);
    const row = await db.transaction(async (tx) => {
      const warnings = await guardrails(tx, ws, d);
      if (r.warning) warnings.push(r.warning);
      const values = {
        id, workspaceId: ws.id, fileName: up.name, byteSize: data.length, sha256: d.sha256, format: d.format,
        fileUrl: up.url, storageKey: key, templateId: r.template?.id ?? null,
        headerRow: r.headerRow, warnings, warningsAccepted: false, context: { ...d.context, fileName: fn },
        referenceDate: period.referenceDate ?? fn.referenceDate,
        referenceWeek: normWeek(period.referenceWeek) ?? (fn.week ? formatWeek(fn.week.year, fn.week.week)
          : d.context.year && d.context.week ? formatWeek(d.context.year, d.context.week) : null),
      };
      const [inserted] = await tx.insert(reportFile).values({ ...values, stage: stageOf(values, r.template) }).returning();
      return inserted;
    });
    const imp = await importFile(id);
    results.push({
      id, fileName: up.name, url: up.url, template: r.template && { id: r.template.id, name: r.template.name },
      context: row.context, referenceDate: row.referenceDate, referenceWeek: row.referenceWeek,
      stage: imp.stage, rowCount: imp.rowCount, issueCount: imp.issueCount, error: imp.error ?? undefined, warnings: row.warnings,
      draft: imp.stage === 'needs_template' ? draftTemplate(d.grid, up.name, ws.code, undefined, d.reader) : undefined,
    });
  }
  return results;
}

export async function ownFile(q: Tx | typeof db, ws: Workspace, fileId: string, lock = false): Promise<FileRow> {
  if (!isUuid(fileId)) fail(404, 'Import not found');
  const sel = q.select().from(reportFile).where(and(eq(reportFile.id, fileId), eq(reportFile.workspaceId, ws.id)));
  const [f] = lock ? await sel.for('update') : await sel;
  return f ?? fail(404, 'Import not found');
}

export const ConfirmInput = z.object({
  reference_date: z.string().regex(DATE).optional(), // for daily exports with no date in their columns or name
  reference_week: z.string().regex(WEEK).optional(), // for weekly exports with no week in their columns or name
  accept_warnings: z.boolean().default(false),       // "Import anyway"
});

export async function confirmFile(ws: Workspace, fileId: string, input: z.input<typeof ConfirmInput>) {
  const b = ConfirmInput.parse(input);
  const res = await db.transaction(async (tx) => {
    const f = await ownFile(tx, ws, fileId, true);
    if (!['needs_confirmation', 'needs_reference_date'].includes(f.stage)) {
      fail(409, `File is ${f.stage}; nothing to confirm`);
    }
    if (f.stage === 'needs_confirmation' && !b.accept_warnings) {
      fail(409, { message: 'This file has warnings; confirm with accept_warnings', warnings: f.warnings });
    }
    const next = {
      referenceDate: b.reference_date ?? f.referenceDate,
      referenceWeek: normWeek(b.reference_week) ?? f.referenceWeek,
      warningsAccepted: f.warningsAccepted || b.accept_warnings,
    };
    let t = f.templateId ? (await tx.select().from(reportTemplate).where(eq(reportTemplate.id, f.templateId)))[0] : null;
    if (t && b.accept_warnings && f.warnings.some((w) => w.code === 'template_changed')) t = await updateTemplateFromFile(tx, f, t);
    let match: { templateId: string; headerRow: number | null } | null = null;
    if (!t && next.warningsAccepted) { // held before its report was taught (e.g. a duplicate): look again now
      const templates = await tx.select().from(reportTemplate).where(eq(reportTemplate.workspaceId, ws.id));
      const m = templates.length
        ? matchTemplate((await readTable(await readOriginal(f), 15)).grid, f.format as Format, f.context?.fileName?.pattern ?? '', templates)
        : null;
      if (m?.kind === 'exact') { t = m.template; match = { templateId: m.template.id, headerRow: m.headerRow }; }
    }
    const stage = stageOf({ ...f, ...next, templateId: t?.id ?? null }, t);
    if (stage === 'needs_reference_date' && f.stage === 'needs_reference_date') {
      fail(422, t?.periodKind === 'week'
        ? 'This export has no week in its columns or name - pick the report week (reference_week)'
        : 'This export has no date in its columns or name - pick the report date (reference_date)');
    }
    await tx.update(reportFile).set({ ...next, ...match, stage, updatedAt: sql`now()` }).where(eq(reportFile.id, f.id));
    return { id: f.id, stage, ...next };
  });
  return { ...res, ...await importFile(res.id) };
}

/** Import a file again, e.g. after it failed or after its template's columns were corrected. */
export async function reimportFile(ws: Workspace, fileId: string) {
  const f = await ownFile(db, ws, fileId);
  if (!['imported', 'failed'].includes(f.stage)) fail(409, `File is ${f.stage}; only imported or failed files can be re-imported`);
  if (!f.storageKey && !f.fileUrl) fail(409, 'The original was deleted after its import (set KEEP_FILES=true to keep originals); upload it again instead');
  await db.update(reportFile).set({ stage: 'queued', updatedAt: sql`now()` }).where(eq(reportFile.id, f.id));
  return importFile(f.id);
}

/** The file's rows as saved: values keyed by column header, driver, day and week, and any values that could not be read. */
export async function fileRows(ws: Workspace, fileId: string, opts: { limit?: number; offset?: number; withIssues?: boolean } = {}) {
  const f = await ownFile(db, ws, fileId);
  const where = opts.withIssues
    ? and(eq(reportRow.fileId, f.id), sql`jsonb_array_length(${reportRow.issues}) > 0`)
    : eq(reportRow.fileId, f.id);
  const [{ total }] = await db.select({ total: count() }).from(reportRow).where(where);
  const rows = await db.select({
    line: reportRow.line, driverKey: reportRow.driverKey, driverName: reportRow.driverName, day: reportRow.day,
    year: reportRow.year, week: reportRow.week, data: reportRow.data, issues: reportRow.issues,
  }).from(reportRow).where(where).orderBy(asc(reportRow.line))
    .limit(Math.min(opts.limit ?? 50, 500)).offset(opts.offset ?? 0);
  return { total, rows };
}

/** The guessed template for an unknown upload: header row, column types, driver and date columns.
 *  `headerRow` redrafts from another row when the guess picked the wrong one. */
export async function templateDraft(ws: Workspace, fileId: string, headerRow?: number): Promise<TemplateDraft> {
  const f = await ownFile(db, ws, fileId);
  if (!f.storageKey && !f.fileUrl) fail(409, 'This file is already imported; its original is no longer kept');
  const table = await readTable(await readOriginal(f), 15);
  return draftTemplate(table.grid, f.fileName, ws.code, headerRow, table.reader);
}

export async function listFiles(ws: Workspace, opts: { stage?: string; limit?: number } = {}) {
  return db.select({
    id: reportFile.id, fileName: reportFile.fileName, templateId: reportFile.templateId, format: reportFile.format,
    stage: reportFile.stage, warnings: reportFile.warnings, context: reportFile.context,
    referenceDate: reportFile.referenceDate, referenceWeek: reportFile.referenceWeek, rowCount: reportFile.rowCount, issueCount: reportFile.issueCount,
    error: reportFile.error, createdAt: reportFile.createdAt, updatedAt: reportFile.updatedAt,
  }).from(reportFile)
    .where(opts.stage ? and(eq(reportFile.workspaceId, ws.id), eq(reportFile.stage, opts.stage)) : eq(reportFile.workspaceId, ws.id))
    .orderBy(desc(reportFile.createdAt)).limit(Math.min(opts.limit ?? 200, 200));
}

export async function getFile(ws: Workspace, fileId: string) {
  const { storageKey, ...visible } = await ownFile(db, ws, fileId); // the storage key is never exposed
  // whether the original can still be read (re-import, template draft): kept locally, or at the caller's URL
  return { ...visible, hasOriginal: Boolean(storageKey || visible.fileUrl) };
}
