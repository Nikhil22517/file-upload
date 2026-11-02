/** A template's analytics: numbers computed from one upload's rows, per file, driver, day or week. */
import type { ColumnSpec, MetricSpec } from './columns.ts';
import type { ParsedRow } from './rows.ts';
import { formatWeek } from './weeks.ts';

export interface MetricValue {
  metricKey: string;
  metricName: string;
  by: MetricSpec['by'];
  groupKey: string;            // '' for the whole file; the driver key, the day or the week ('2026-W27') otherwise
  groupLabel: string | null;   // the driver's name, when grouped by driver
  day: string | null;
  year: number | null;
  week: number | null;
  value: number | null;        // null when no row had a number to aggregate
  rowCount: number;            // rows that fed the value
}

const same = (a: unknown, b: string) => String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

export function computeMetrics(rows: ParsedRow[], columns: ColumnSpec[], specs: MetricSpec[]): MetricValue[] {
  const nameOf = (key: string | null | undefined) => (key ? columns.find((c) => c.key === key)?.header ?? null : null);
  const out: MetricValue[] = [];
  for (const spec of specs) {
    const col = nameOf(spec.column);
    const where = spec.where ? { name: nameOf(spec.where.column), equals: spec.where.equals } : null;
    const groups = new Map<string, { rows: ParsedRow[]; label: string | null; day: string | null; year: number | null; week: number | null }>();
    for (const r of rows) {
      if (where?.name && !same(r.data[where.name], where.equals)) continue;
      let key = '';
      if (spec.by === 'driver') key = r.driverKey ?? r.driverName ?? '';
      if (spec.by === 'day') key = r.day ?? '';
      if (spec.by === 'week') key = r.year !== null && r.week !== null ? formatWeek(r.year, r.week) : '';
      if (spec.by !== 'file' && !key) continue; // a row with no driver/day/week can't be placed in a group
      const g = groups.get(key) ?? { rows: [], label: null, day: null, year: null, week: null };
      if (!groups.has(key)) {
        g.label = spec.by === 'driver' ? r.driverName : null;
        g.day = spec.by === 'day' ? r.day : null;
        [g.year, g.week] = spec.by === 'week' || spec.by === 'day' ? [r.year, r.week] : [null, null];
        groups.set(key, g);
      }
      g.rows.push(r);
    }
    for (const [groupKey, g] of groups) {
      const values = col ? g.rows.map((r) => r.data[col]).filter((v) => v !== null && v !== undefined && v !== '') : [];
      const nums = values.filter((v): v is number => typeof v === 'number');
      let value: number | null = null;
      let used = nums.length;
      switch (spec.op) {
        case 'count': value = col ? values.length : g.rows.length; used = value; break;
        case 'count_distinct': value = new Set(values.map(String)).size; used = values.length; break;
        case 'sum': value = nums.length ? nums.reduce((a, b) => a + b, 0) : null; break;
        case 'avg': value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
        case 'min': value = nums.length ? Math.min(...nums) : null; break;
        case 'max': value = nums.length ? Math.max(...nums) : null; break;
      }
      out.push({ metricKey: spec.key, metricName: spec.name, by: spec.by, groupKey, groupLabel: g.label, day: g.day, year: g.year, week: g.week, value, rowCount: used });
    }
  }
  return out;
}
