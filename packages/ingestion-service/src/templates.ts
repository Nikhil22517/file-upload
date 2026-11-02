/** Report templates: everything a workspace knows about a report, configured by its users. Taught once from an
 *  upload, then editable: which columns to keep and how to read them, which PDF sections, the period, the analytics. */
import { db, reportFile, reportMetric, reportTemplate } from '@platform/db';
import {
  COLUMN_ROLES, COLUMN_TYPES, type ColumnSpec, METRIC_GROUPS, METRIC_OPS, type MetricSpec, PERIOD_KINDS, draftTemplate,
  headerSignature, periodKindOf, periodSourceOf, readTable,
} from '@platform/ingestion';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail, isUniqueViolation, isUuid } from './errors.ts';
import { ownFile } from './files.ts';
import { importAll, recomputeMetrics } from './importer.ts';
import { type TemplateRow, applyToWaiting, stageOf } from './stages.ts';
import { readOriginal } from './storage.ts';
import type { Workspace } from './workspaces.ts';

const ColumnChange = z.object({
  key: z.string(),
  type: z.enum(COLUMN_TYPES).optional(),
  role: z.enum(COLUMN_ROLES).nullable().optional(),
  include: z.boolean().optional(),                      // false: skip this column (its values are not saved)
});

const Metric = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/).max(60).optional(), // defaults to the name, slugged
  name: z.string().trim().min(1).max(120),
  op: z.enum(METRIC_OPS),
  column: z.string().nullable().default(null),          // column key; null only for 'count' (counts rows)
  by: z.enum(METRIC_GROUPS).default('file'),
  where: z.object({ column: z.string(), equals: z.string() }).nullable().optional(),
});

/** What a user controls on a template, besides its columns. */
const Controls = {
  name: z.string().trim().min(1).max(120).optional(),
  period_kind: z.enum(PERIOD_KINDS).optional(),         // what one upload covers: a day or a week
  sections: z.array(z.string().trim().min(1)).nullable().optional(), // PDF sections to keep; null = all
  metrics: z.array(Metric).optional(),                  // analytics; replaces the template's list
  columns: z.array(ColumnChange).default([]),           // only the columns the user changed
};

export const TemplateInput = z.object({
  file_id: z.string(),                                  // an upload waiting at needs_template
  header_row: z.number().int().min(0).max(14).optional(), // only when the guessed header row is wrong
  ...Controls,
});

export const TemplateUpdate = z.object(Controls);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'metric';

/** Apply column changes; a role moves (whoever held it before loses it). A header can repeat (Amazon writes
 *  'undefined' three times): every column is kept, a change applies to all columns with that key, a role to the first. */
function applyColumnChanges(columns: ColumnSpec[], changes: z.infer<typeof ColumnChange>[]): ColumnSpec[] {
  const out = columns.map((c) => ({ ...c }));
  for (const ch of changes) {
    const cols = out.filter((c) => c.key === ch.key);
    if (!cols.length) fail(422, `No column "${ch.key}" in this report`);
    for (const col of cols) {
      if (ch.type) col.type = ch.type;
      if (ch.include !== undefined) col.include = ch.include;
    }
    if (ch.role !== undefined) {
      if (ch.role) for (const other of out) if (other.role === ch.role) other.role = null;
      for (const col of cols) col.role = null;
      cols[0].role = ch.role;
    }
  }
  return out;
}

/** Analytics checked against the template's columns; each gets a unique key. */
function checkMetrics(metrics: z.infer<typeof Metric>[], columns: ColumnSpec[]): MetricSpec[] {
  const keys = new Set(columns.map((c) => c.key));
  const seen = new Set<string>();
  return metrics.map((m) => {
    if (m.op !== 'count' && !m.column) fail(422, `Analytic "${m.name}": choose the column to ${m.op}`);
    if (m.column && !keys.has(m.column)) fail(422, `Analytic "${m.name}": no column "${m.column}" in this report`);
    if (m.where && !keys.has(m.where.column)) fail(422, `Analytic "${m.name}": no column "${m.where.column}" to filter on`);
    let key = m.key ?? slug(m.name);
    for (let n = 2; seen.has(key); n++) key = `${m.key ?? slug(m.name)}_${n}`;
    seen.add(key);
    return { key, name: m.name, op: m.op, column: m.column, by: m.by, where: m.where ?? null };
  });
}

export async function teachTemplate(ws: Workspace, input: z.input<typeof TemplateInput>) {
  const b = TemplateInput.parse(input);
  const res = await db.transaction(async (tx) => {
    const f = await ownFile(tx, ws, b.file_id, true);
    if (f.stage !== 'needs_template') fail(409, `File is ${f.stage}; it does not need a template`);
    const table = await readTable(await readOriginal(f), 15);
    const draft = draftTemplate(table.grid, f.fileName, ws.code, b.header_row, table.reader);
    const columns = applyColumnChanges(draft.columns, b.columns);
    const name = b.name ?? (draft.name || f.fileName); // a name made only of dates leaves no suggestion
    const headers = columns.map((col) => col.key);

    let t: TemplateRow;
    try {
      [t] = await tx.insert(reportTemplate).values({
        workspaceId: ws.id, name, format: f.format, headerRow: draft.headerRow, headers,
        headerSignature: headerSignature(headers), fileNamePattern: draft.fileNamePattern, columns,
        periodSource: periodSourceOf(columns, draft.fileNamePattern), periodKind: b.period_kind ?? periodKindOf(columns, draft.fileNamePattern),
        reader: draft.reader, sections: b.sections ?? null, metrics: checkMetrics(b.metrics ?? [], columns),
      }).returning();
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `A report template named "${name}" already exists; send another name`);
      throw e;
    }
    const stage = stageOf({ ...f, templateId: t.id }, t);
    await tx.update(reportFile).set({ templateId: t.id, headerRow: draft.headerRow, stage, updatedAt: sql`now()` })
      .where(eq(reportFile.id, f.id));
    return { template: t, files: [{ id: f.id, stage }, ...await applyToWaiting(tx, t, f.id)] };
  });
  return { template: res.template, files: await importAll(res.files.map((x) => x.id)) };
}

/** Change a template. Columns, sections and the period apply to uploads from now on (re-import an upload whose
 *  original was kept to apply them to it); analytics are recomputed at once for every upload, from its saved rows. */
export async function updateTemplate(ws: Workspace, id: string, input: z.input<typeof TemplateUpdate>) {
  const b = TemplateUpdate.parse(input);
  const t = await getTemplate(ws, id);
  const columns = applyColumnChanges(t.columns, b.columns);
  const metrics = b.metrics ? checkMetrics(b.metrics, columns) : checkMetrics(t.metrics, columns);
  let updated: TemplateRow;
  try {
    [updated] = await db.update(reportTemplate).set({
      name: b.name ?? t.name, columns, metrics,
      periodSource: periodSourceOf(columns, t.fileNamePattern),
      periodKind: b.period_kind ?? t.periodKind,
      sections: b.sections === undefined ? t.sections : b.sections,
      version: sql`${reportTemplate.version} + 1`, updatedAt: sql`now()`,
    }).where(eq(reportTemplate.id, t.id)).returning();
  } catch (e) {
    if (isUniqueViolation(e)) fail(409, `A report template named "${b.name}" already exists`);
    throw e;
  }
  const metricsChanged = JSON.stringify(t.metrics) !== JSON.stringify(updated.metrics);
  return { template: updated, metricValues: metricsChanged ? await recomputeMetrics(updated) : null };
}

export async function listTemplates(ws: Workspace) {
  const files = db.select({ templateId: reportFile.templateId, n: count().as('n') }).from(reportFile)
    .where(eq(reportFile.workspaceId, ws.id)).groupBy(reportFile.templateId).as('files');
  return db.select({ template: reportTemplate, uploads: sql<number>`coalesce(${files.n}, 0)`.mapWith(Number) })
    .from(reportTemplate).leftJoin(files, eq(files.templateId, reportTemplate.id))
    .where(eq(reportTemplate.workspaceId, ws.id)).orderBy(asc(reportTemplate.name))
    .then((rows) => rows.map((r) => ({ ...r.template, uploads: r.uploads })));
}

export async function getTemplate(ws: Workspace, id: string): Promise<TemplateRow> {
  if (!isUuid(id)) fail(404, 'Template not found');
  const [t] = await db.select().from(reportTemplate).where(and(eq(reportTemplate.id, id), eq(reportTemplate.workspaceId, ws.id)));
  return t ?? fail(404, 'Template not found');
}

/** A template's analytics: the computed values, newest uploads first. */
export async function templateMetrics(ws: Workspace, id: string, opts: { metricKey?: string; limit?: number } = {}) {
  const t = await getTemplate(ws, id);
  const where = opts.metricKey
    ? and(eq(reportMetric.templateId, t.id), eq(reportMetric.metricKey, opts.metricKey))
    : eq(reportMetric.templateId, t.id);
  return db.select({
    fileId: reportMetric.fileId, fileName: reportFile.fileName, metricKey: reportMetric.metricKey, metricName: reportMetric.metricName,
    groupBy: reportMetric.groupBy, groupKey: reportMetric.groupKey, groupLabel: reportMetric.groupLabel,
    day: reportMetric.day, year: reportMetric.year, week: reportMetric.week, value: reportMetric.value, rowCount: reportMetric.rowCount,
  }).from(reportMetric).innerJoin(reportFile, eq(reportFile.id, reportMetric.fileId)).where(where)
    .orderBy(desc(reportFile.createdAt), asc(reportMetric.metricKey), asc(reportMetric.groupKey))
    .limit(Math.min(opts.limit ?? 500, 2000));
}

/** Analytics of one upload (the file page). */
export async function fileMetrics(ws: Workspace, fileId: string) {
  const f = await ownFile(db, ws, fileId);
  return db.select().from(reportMetric).where(eq(reportMetric.fileId, f.id))
    .orderBy(asc(reportMetric.metricKey), desc(reportMetric.value));
}
