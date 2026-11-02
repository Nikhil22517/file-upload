/** Column types and roles of a report template. Kept free of Node imports so browser code
 *  (the template editor in the web app) can use them: import from '@platform/ingestion/columns'. */
export const COLUMN_TYPES = ['text', 'id', 'int', 'decimal', 'percent', 'date', 'datetime', 'week', 'yn'] as const;
export const COLUMN_ROLES = ['driver_id', 'driver_name', 'date', 'week'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type ColumnRole = (typeof COLUMN_ROLES)[number];
/** One column of a report as its template keeps it. `include: false` skips the column (its values are not saved). */
export interface ColumnSpec { header: string; key: string; type: ColumnType; role: ColumnRole | null; include?: boolean }
export type PeriodSource = 'column' | 'filename' | 'ask';
/** What one upload of a report covers: a day (daily exports) or an Amazon week (weekly ones). When the period has to
 *  be asked for, it decides whether the uploader picks a date or a week. */
export const PERIOD_KINDS = ['day', 'week'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** Where a template's report date comes from: a date or week column, else the file name, else the uploader. */
export function periodSourceOf(columns: Pick<ColumnSpec, 'role'>[], fileNamePattern: string): PeriodSource {
  if (columns.some((c) => c.role === 'date' || c.role === 'week')) return 'column';
  if (/\{(date|week)\}/.test(fileNamePattern)) return 'filename';
  return 'ask';
}

/** Analytics a template computes from each upload's rows: one number per file, driver, day or week. */
export const METRIC_OPS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'] as const;
export const METRIC_GROUPS = ['file', 'driver', 'day', 'week'] as const;
export type MetricOp = (typeof METRIC_OPS)[number];
export type MetricGroup = (typeof METRIC_GROUPS)[number];
export interface MetricSpec {
  key: string;                                  // stable id within the template, e.g. 'total_packages'
  name: string;                                 // shown to people: 'Total packages'
  op: MetricOp;
  column: string | null;                        // column key the op reads; null only for 'count' (counts rows)
  by: MetricGroup;
  where?: { column: string; equals: string } | null; // only rows whose column has this value, e.g. Section = Driver
}
