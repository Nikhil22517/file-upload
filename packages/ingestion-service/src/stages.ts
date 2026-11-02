/** Where an upload stands, and keeping templates in step with the files that match them. */
import { db, reportFile, reportTemplate } from '@platform/db';
import { guessColumns, headerSignature, matchTemplate, periodSourceOf, previewGrid } from '@platform/ingestion';
import { and, eq, ne, sql } from 'drizzle-orm';
import { readOriginal } from './storage.ts';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FileRow = typeof reportFile.$inferSelect;
export type TemplateRow = typeof reportTemplate.$inferSelect;
export type Warning = { code: string; message: string };

/** Uploads still on the books: a new upload with the same content is a duplicate of these. */
export const ACTIVE_STAGES = ['queued', 'imported', 'stored_file_only', 'needs_confirmation', 'needs_template', 'needs_reference_date'];

type StageInput = Pick<FileRow, 'warnings' | 'warningsAccepted' | 'templateId' | 'referenceDate' | 'referenceWeek'>;

/** Does this upload still need its period from the uploader? Not when its rows carry a date or week column;
 *  otherwise it needs the day (daily reports) or the week (weekly ones), from the file name or picked by hand. */
export function needsPeriod(f: Pick<FileRow, 'referenceDate' | 'referenceWeek'>, t: Pick<TemplateRow, 'periodSource' | 'periodKind'>): boolean {
  if (t.periodSource === 'column') return false;
  return t.periodKind === 'week' ? !f.referenceWeek && !f.referenceDate : !f.referenceDate;
}

/** Warnings come first (nobody should teach a template from a duplicate or another DSP's export),
 *  then which report it is (a template), then which period it covers. */
export function stageOf(f: StageInput, t?: Pick<TemplateRow, 'periodSource' | 'periodKind'> | null): string {
  if (f.warnings.length && !f.warningsAccepted) return 'needs_confirmation';
  if (!f.templateId || !t) return 'needs_template';
  if (needsPeriod(f, t)) return 'needs_reference_date';
  return 'queued';
}

export const changedWarning = (t: TemplateRow, added: string[], missing: string[]): Warning => ({
  code: 'template_changed',
  message: `Looks like ${t.name}, but its columns changed`
    + `${added.length ? ` (new: ${added.join(', ')})` : ''}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`
    + '. Confirm to update the template.',
});

const fileGrid = async (f: FileRow) => previewGrid(await readOriginal(f));

/** A confirmed "columns changed" upload becomes the template's new shape. Columns the template already
 *  knew keep their type, role and include setting; new ones get guesses, minus any role an existing column holds. */
export async function updateTemplateFromFile(tx: Tx, f: FileRow, t: TemplateRow): Promise<TemplateRow> {
  const grid = await fileGrid(f);
  const headerRow = f.headerRow ?? t.headerRow;
  if (!grid || headerRow === null) return t;
  const known = new Map(t.columns.map((c) => [c.key, c]));
  const guessed = guessColumns(grid, headerRow);
  const kept = new Set(guessed.flatMap((g) => known.get(g.key)?.role ?? []));
  const columns = guessed.map((g) => known.get(g.key) ?? { ...g, role: g.role && kept.has(g.role) ? null : g.role });
  const headers = columns.map((c) => c.key);
  const [updated] = await tx.update(reportTemplate).set({
    headers, headerSignature: headerSignature(headers), headerRow, columns,
    periodSource: periodSourceOf(columns, t.fileNamePattern),
    version: sql`${reportTemplate.version} + 1`, updatedAt: sql`now()`,
  }).where(eq(reportTemplate.id, t.id)).returning();
  return updated;
}

/** After a template is taught, other uploads of the same report that were waiting move on by themselves. */
export async function applyToWaiting(tx: Tx, t: TemplateRow, exceptId: string): Promise<{ id: string; stage: string }[]> {
  const waiting = await tx.select().from(reportFile)
    .where(and(eq(reportFile.workspaceId, t.workspaceId), eq(reportFile.stage, 'needs_template'), ne(reportFile.id, exceptId)))
    .limit(100);
  const moved = [];
  for (const f of waiting) {
    const pattern = f.context?.fileName?.pattern ?? '';
    const m = matchTemplate(await fileGrid(f), f.format as 'csv' | 'xlsx' | 'pdf', pattern, [t]);
    if (m?.kind !== 'exact') continue;
    const stage = stageOf({ ...f, templateId: t.id }, t);
    await tx.update(reportFile).set({ templateId: t.id, headerRow: m.headerRow, stage, updatedAt: sql`now()` })
      .where(eq(reportFile.id, f.id));
    moved.push({ id: f.id, stage });
  }
  return moved;
}
