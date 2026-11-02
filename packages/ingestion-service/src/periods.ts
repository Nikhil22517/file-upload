/** Reports by period: what a daily report says about one day, or a weekly report about one Amazon week.
 *  When several uploads cover the same period, the latest one per station wins (a re-export replaces the earlier
 *  one), so the same rows are never shown twice. */
import { db, reportFile, reportRow, reportTemplate } from '@platform/db';
import { type MetricValue, type ParsedRow, PERIOD_KINDS, type PeriodKind, computeMetrics, formatWeek, parseWeek } from '@platform/ingestion';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from './errors.ts';
import { DATE, WEEK } from './files.ts';
import { getTemplate } from './templates.ts';
import type { Workspace } from './workspaces.ts';

const MAX_ROWS = 5000;

export const PeriodQuery = z.object({
  kind: z.enum(PERIOD_KINDS),
  template_id: z.string().optional(), // default: the report with the most recent data
  period: z.string().optional(),      // '2026-07-01' (day) or '2026-W27' (week); default: the report's latest
});

/** The workspace's daily (or weekly) reports, each with the periods it has imported data for, newest first. */
export async function reportPeriods(ws: Workspace, kind: PeriodKind) {
  const templates = await db.select({ id: reportTemplate.id, name: reportTemplate.name }).from(reportTemplate)
    .where(and(eq(reportTemplate.workspaceId, ws.id), eq(reportTemplate.periodKind, kind))).orderBy(asc(reportTemplate.name));
  const periods = new Map<string, string[]>(templates.map((t) => [t.id, []]));
  if (templates.length) {
    const scope = and(
      eq(reportRow.workspaceId, ws.id), eq(reportFile.stage, 'imported'), inArray(reportRow.templateId, [...periods.keys()]),
    );
    const found = kind === 'day'
      ? await db.selectDistinct({ templateId: reportRow.templateId, day: reportRow.day }).from(reportRow)
        .innerJoin(reportFile, eq(reportFile.id, reportRow.fileId)).where(and(scope, isNotNull(reportRow.day)))
        .orderBy(desc(reportRow.day))
        .then((rs) => rs.map((r) => ({ templateId: r.templateId, period: r.day! })))
      : await db.selectDistinct({ templateId: reportRow.templateId, year: reportRow.year, week: reportRow.week }).from(reportRow)
        .innerJoin(reportFile, eq(reportFile.id, reportRow.fileId))
        .where(and(scope, isNotNull(reportRow.year), isNotNull(reportRow.week)))
        .orderBy(desc(reportRow.year), desc(reportRow.week))
        .then((rs) => rs.map((r) => ({ templateId: r.templateId, period: formatWeek(r.year!, r.week!) })));
    for (const f of found) periods.get(f.templateId!)?.push(f.period);
  }
  return templates.map((t) => ({ ...t, periods: periods.get(t.id) ?? [] }));
}

export interface PeriodReport {
  template: { id: string; name: string; periodKind: string };
  period: string;
  files: { id: string; fileName: string; station: string | null; createdAt: Date }[];    // the uploads shown
  replaced: { id: string; fileName: string; station: string | null; createdAt: Date }[]; // older uploads of the same period
  columns: string[];
  rows: ParsedRow[];
  truncated: boolean;
  metrics: MetricValue[]; // the template's analytics, worked out for this period's rows
}

/** One report for one day or week: its rows from the latest upload(s) and its analytics for exactly those rows. */
export async function periodReport(ws: Workspace, templateId: string, period: string): Promise<PeriodReport> {
  const t = await getTemplate(ws, templateId);
  let match;
  if (t.periodKind === 'week') {
    const w = parseWeek(period);
    if (!w || !WEEK.test(period)) fail(400, 'period must be an Amazon week like 2026-W27');
    match = and(eq(reportRow.year, w!.year), eq(reportRow.week, w!.week));
  } else {
    if (!DATE.test(period)) fail(400, 'period must be a date like 2026-07-01');
    match = eq(reportRow.day, period);
  }
  const fileIds = db.selectDistinct({ id: reportRow.fileId }).from(reportRow)
    .where(and(eq(reportRow.workspaceId, ws.id), eq(reportRow.templateId, t.id), match));
  const all = await db.select({ id: reportFile.id, fileName: reportFile.fileName, context: reportFile.context, createdAt: reportFile.createdAt })
    .from(reportFile).where(and(inArray(reportFile.id, fileIds), eq(reportFile.stage, 'imported'))).orderBy(desc(reportFile.createdAt));

  const latest = new Map<string, (typeof all)[number]>();
  for (const f of all) {
    const station = f.context?.station ?? '';
    if (!latest.has(station)) latest.set(station, f);
  }
  const shown = new Set([...latest.values()].map((f) => f.id));
  const brief = (f: (typeof all)[number]) => ({ id: f.id, fileName: f.fileName, station: f.context?.station ?? null, createdAt: f.createdAt });

  const rows: ParsedRow[] = shown.size
    ? await db.select({
      line: reportRow.line, driverKey: reportRow.driverKey, driverName: reportRow.driverName, day: reportRow.day,
      year: reportRow.year, week: reportRow.week, data: reportRow.data, issues: reportRow.issues,
    }).from(reportRow).where(and(inArray(reportRow.fileId, [...shown]), match))
      .orderBy(asc(reportRow.fileId), asc(reportRow.line)).limit(MAX_ROWS + 1)
    : [];
  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows.length = MAX_ROWS;

  // the template's kept columns, in its order, then anything else the rows carry (e.g. a PDF's Section)
  const present = new Set(rows.flatMap((r) => Object.keys(r.data)));
  const ordered = t.columns.filter((c) => c.include !== false && present.has(c.header)).map((c) => c.header);
  const columns = [...ordered, ...[...present].filter((c) => !ordered.includes(c))];

  return {
    template: { id: t.id, name: t.name, periodKind: t.periodKind },
    period,
    files: all.filter((f) => shown.has(f.id)).map(brief),
    replaced: all.filter((f) => !shown.has(f.id)).map(brief),
    columns,
    rows,
    truncated,
    metrics: computeMetrics(rows, t.columns, t.metrics),
  };
}

/** The Daily / Weekly screen in one call: the reports of that kind and the chosen one for the chosen period.
 *  Defaults: the report with the most recent data, and its latest period. */
export async function periodView(ws: Workspace, input: z.input<typeof PeriodQuery>) {
  const q = PeriodQuery.parse(input);
  const reports = await reportPeriods(ws, q.kind);
  const newest = [...reports].filter((r) => r.periods.length).sort((a, b) => b.periods[0].localeCompare(a.periods[0]))[0];
  const chosen = (q.template_id ? reports.find((r) => r.id === q.template_id) : null) ?? newest ?? reports[0] ?? null;
  const period = q.period || chosen?.periods[0] || null;
  const report = chosen && period ? await periodReport(ws, chosen.id, period) : null;
  return { kind: q.kind, reports, templateId: chosen?.id ?? null, period, report };
}
