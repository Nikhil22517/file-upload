/**
 * Postgres schema: the workspace (tenant), report_template, report_file, report_row and report_metric.
 * Every report is a template the workspace configured; there are no built-in report types.
 * Identities and KPIs get their tables when those parts are built.
 * Column names are snake_case in the database (drizzle `casing: 'snake_case'`), camelCase in code.
 * TODO before production: row-level security on workspace_id (design doc, section 4).
 */
import type { CellValue, ColumnSpec, FileContext, FileNameInfo, MetricSpec, RowIssue } from '@platform/ingestion';
import {
  bigserial, boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const workspace = pgTable('workspace', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(), // DSP code, e.g. PTLG; used by the foreign-DSP guardrail
  name: text().notNull(),
  createdAt: createdAt(),
});

/** A report type a user taught by confirming the draft of its first upload.
 *  Later uploads match it by their header row (exact or close) and their file-name pattern. */
export const reportTemplate = pgTable('report_template', {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  format: text().notNull(),                 // csv | xlsx | pdf
  headerRow: integer(),                     // null for PDFs
  headers: jsonb().$type<string[]>().notNull(), // normalised header row
  headerSignature: text().notNull(),
  fileNamePattern: text().notNull(),        // e.g. quality_overview_{dsp}_{station}_{date}
  columns: jsonb().$type<ColumnSpec[]>().notNull(),
  periodSource: text().notNull(),           // column | filename | ask
  periodKind: text().notNull().default('day'), // day | week: what one upload covers, so what to ask for when the period is missing
  reader: text(),                           // PDF reader that turns this report into a table (null: a table file)
  sections: jsonb().$type<string[] | null>(), // PDF sections to keep (Driver, Summary...); null = all
  metrics: jsonb().$type<MetricSpec[]>().notNull().default([]), // analytics computed from each upload's rows
  version: integer().notNull().default(1),  // bumped when a changed upload updates the columns
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.workspaceId, t.name),
  index('report_template_ws_sig').on(t.workspaceId, t.headerSignature),
]);

export const reportFile = pgTable('report_file', {
  id: uuid().primaryKey(),
  workspaceId: uuid().notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  fileName: text().notNull(),
  byteSize: integer().notNull(),
  sha256: text().notNull(),
  format: text().notNull(),                 // csv | xlsx | pdf
  fileUrl: text(),                          // where the caller stored the original, when uploaded by URL
  storageKey: text(),                       // else a local copy, deleted after the import (null then)
  templateId: uuid().references(() => reportTemplate.id, { onDelete: 'set null' }), // the report it is, as this workspace taught it
  headerRow: integer(),
  // held: needs_confirmation | needs_template | needs_reference_date
  // then: queued -> imported (rows in report_row) | stored_file_only (PDF) | failed
  stage: text().notNull(),
  warnings: jsonb().$type<{ code: string; message: string }[]>().notNull().default([]),
  warningsAccepted: boolean().notNull().default(false),
  context: jsonb().$type<FileContext & { fileName?: FileNameInfo }>(), // what recognition read from the content and the name
  referenceDate: date({ mode: 'string' }),  // report date for exports with no date column
  referenceWeek: text(),                    // report week ('2026-W27') for weekly exports with no week column
  rowCount: integer(),                      // set by the import
  issueCount: integer(),                    // rows with at least one value that could not be read
  error: text(),                            // why the import failed
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('report_file_ws_sha').on(t.workspaceId, t.sha256),
  index('report_file_ws_created').on(t.workspaceId, t.createdAt),
]);

/** One line of an imported file, for every report type alike: the values as JSON keyed by column header,
 *  plus the driver and day pulled out so they can be filtered on. Re-importing a file replaces its rows. */
export const reportRow = pgTable('report_row', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  workspaceId: uuid().notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  fileId: uuid().notNull().references(() => reportFile.id, { onDelete: 'cascade' }),
  templateId: uuid().references(() => reportTemplate.id, { onDelete: 'set null' }),
  line: integer().notNull(),                // line in the file, 1-based
  driverKey: text(),                        // value of the driver_id column
  driverName: text(),
  day: date({ mode: 'string' }),
  year: integer(),                          // Amazon week
  week: integer(),
  data: jsonb().$type<Record<string, CellValue>>().notNull(),
  issues: jsonb().$type<RowIssue[]>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [
  unique().on(t.fileId, t.line),
  index('report_row_ws_driver').on(t.workspaceId, t.driverKey, t.day),
  index('report_row_ws_report').on(t.workspaceId, t.templateId, t.day),
]);

/** A template's analytics for one upload: one number per metric and group (the whole file, a driver, a day or a week).
 *  Computed from the file's rows on import, and again whenever the template's metrics change. */
export const reportMetric = pgTable('report_metric', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  workspaceId: uuid().notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  fileId: uuid().notNull().references(() => reportFile.id, { onDelete: 'cascade' }),
  templateId: uuid().references(() => reportTemplate.id, { onDelete: 'set null' }),
  metricKey: text().notNull(),
  metricName: text().notNull(),
  groupBy: text().notNull(),                // file | driver | day | week
  groupKey: text().notNull(),               // '' for the file; else the driver key, day or week
  groupLabel: text(),                       // driver name
  day: date({ mode: 'string' }),
  year: integer(),
  week: integer(),
  value: doublePrecision(),
  rowCount: integer().notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique().on(t.fileId, t.metricKey, t.groupKey),
  index('report_metric_ws_template').on(t.workspaceId, t.templateId, t.metricKey),
]);
