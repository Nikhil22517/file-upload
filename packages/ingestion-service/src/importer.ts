/** Read a queued file's rows into report_row, and its template's analytics into report_metric. It runs right after a
 *  file reaches 'queued' (upload, confirm, teaching a template). Re-running replaces the file's rows and metrics,
 *  so it is safe to repeat (when the original was kept). */
import { db, reportFile, reportMetric, reportRow, reportTemplate } from '@platform/db';
import { type MetricSpec, type ParsedRow, buildRows, computeMetrics, findHeaderRow, parseWeek, readTable } from '@platform/ingestion';
import { eq, inArray, sql } from 'drizzle-orm';
import { config } from './config.ts';
import type { FileRow, TemplateRow, Tx } from './stages.ts';
import { deleteFile, readOriginal } from './storage.ts';

const CHUNK = 1000; // rows per insert, well under Postgres' parameter limit

export interface ImportResult { id: string; stage: string; rowCount: number | null; issueCount: number | null; error: string | null }

/** The week an upload covers when its rows don't say: picked by the uploader, from the file name, or read from a PDF. */
function fileWeek(f: FileRow) {
  return parseWeek(f.referenceWeek) ?? f.context?.fileName?.week
    ?? (f.context?.year && f.context.week ? { year: f.context.year, week: f.context.week } : null);
}

async function saveMetrics(tx: Tx, f: Pick<FileRow, 'id' | 'workspaceId' | 'templateId'>, rows: ParsedRow[], t: TemplateRow) {
  await tx.delete(reportMetric).where(eq(reportMetric.fileId, f.id));
  const values = computeMetrics(rows, t.columns, t.metrics as MetricSpec[]);
  for (let i = 0; i < values.length; i += CHUNK) {
    await tx.insert(reportMetric).values(values.slice(i, i + CHUNK).map((m) => ({
      workspaceId: f.workspaceId, fileId: f.id, templateId: f.templateId, metricKey: m.metricKey, metricName: m.metricName,
      groupBy: m.by, groupKey: m.groupKey, groupLabel: m.groupLabel, day: m.day, year: m.year, week: m.week,
      value: m.value, rowCount: m.rowCount,
    })));
  }
  return values.length;
}

export async function importFile(fileId: string): Promise<ImportResult> {
  const [f] = await db.select().from(reportFile).where(eq(reportFile.id, fileId));
  if (!f) throw new Error(`report_file ${fileId} not found`);
  if (f.stage !== 'queued') return { id: f.id, stage: f.stage, rowCount: f.rowCount, issueCount: f.issueCount, error: f.error };
  const finish = async (set: { stage: string; rowCount?: number; issueCount?: number; error?: string | null }) => {
    await db.update(reportFile).set({ error: null, ...set, updatedAt: sql`now()` }).where(eq(reportFile.id, f.id));
    return { id: f.id, rowCount: null, issueCount: null, error: null, ...set };
  };
  try {
    const [t] = f.templateId ? await db.select().from(reportTemplate).where(eq(reportTemplate.id, f.templateId)) : [];
    if (!t) throw new Error('the template for this file is missing');
    const table = await readTable(await readOriginal(f));
    if (!table.grid) return await finish({ stage: 'stored_file_only', rowCount: 0, issueCount: 0 }); // a PDF no reader understands
    const headerRow = f.headerRow ?? t.headerRow ?? findHeaderRow(table.grid);
    const period = { day: t.periodKind === 'week' ? null : f.referenceDate, week: fileWeek(f) };
    const rows = buildRows(table.grid, headerRow, t.columns, period, { sections: t.sections });
    const issueCount = rows.filter((r) => r.issues.length).length;

    await db.transaction(async (tx) => {
      await tx.delete(reportRow).where(eq(reportRow.fileId, f.id));
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.insert(reportRow).values(rows.slice(i, i + CHUNK).map((r) => ({
          ...r, workspaceId: f.workspaceId, fileId: f.id, templateId: f.templateId,
        })));
      }
      await saveMetrics(tx, f, rows, t);
      await tx.update(reportFile).set({
        stage: 'imported', rowCount: rows.length, issueCount, error: null, updatedAt: sql`now()`,
        ...(config.KEEP_FILES ? {} : { storageKey: null }),
      }).where(eq(reportFile.id, f.id));
    });
    // the rows are saved, so the original is no longer needed (PDFs without a reader and failed files keep theirs)
    if (!config.KEEP_FILES && f.storageKey) await deleteFile(f.storageKey);
    return { id: f.id, stage: 'imported', rowCount: rows.length, issueCount, error: null };
  } catch (e) { // the failure is recorded on the file; the original stays stored for a retry
    console.error(`import of file ${f.id} failed:`, e);
    return finish({ stage: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Import every queued file among `ids` (others are returned as they stand). */
export async function importAll(ids: string[]): Promise<ImportResult[]> {
  const out = [];
  for (const id of ids) out.push(await importFile(id));
  return out;
}

/** Recompute a template's analytics for every file already imported with it, from the saved rows: changing a
 *  template's metrics never needs the originals again. Returns how many values were written. */
export async function recomputeMetrics(t: TemplateRow): Promise<number> {
  const files = await db.select({ id: reportFile.id, workspaceId: reportFile.workspaceId, templateId: reportFile.templateId })
    .from(reportFile).where(eq(reportFile.templateId, t.id));
  let written = 0;
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const rows = await db.select().from(reportRow).where(inArray(reportRow.fileId, batch.map((x) => x.id)));
    await db.transaction(async (tx) => {
      for (const f of batch) written += await saveMetrics(tx, f, rows.filter((r) => r.fileId === f.id), t);
    });
  }
  return written;
}
