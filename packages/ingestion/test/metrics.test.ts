import { describe, expect, it } from 'vitest';
import type { ColumnSpec } from '../src/columns.ts';
import { computeMetrics } from '../src/metrics.ts';
import type { ParsedRow } from '../src/rows.ts';

const columns: ColumnSpec[] = [
  { header: 'Section', key: 'section', type: 'text', role: null },
  { header: 'Gallons', key: 'gallons', type: 'decimal', role: null },
  { header: 'Card', key: 'card', type: 'id', role: null },
];
const row = (driver: string | null, day: string, data: Record<string, unknown>): ParsedRow => ({
  line: 2, driverKey: driver, driverName: driver && `Name ${driver}`, day, year: 2026, week: 27, data: data as ParsedRow['data'], issues: [],
});
const rows = [
  row('E1', '2026-07-01', { Section: 'Driver', Gallons: 10, Card: 'C1' }),
  row('E1', '2026-07-02', { Section: 'Driver', Gallons: 5, Card: 'C1' }),
  row('E2', '2026-07-01', { Section: 'Driver', Gallons: null, Card: 'C2' }),
  row(null, '2026-07-01', { Section: 'Summary', Gallons: 100, Card: null }),
];

describe('computeMetrics', () => {
  it('aggregates per file, driver, day and week, skipping empty values', () => {
    const out = computeMetrics(rows, columns, [
      { key: 'total', name: 'Total', op: 'sum', column: 'gallons', by: 'file' },
      { key: 'per_driver', name: 'Per driver', op: 'avg', column: 'gallons', by: 'driver' },
      { key: 'days', name: 'Fills per day', op: 'count', column: null, by: 'day' },
      { key: 'cards', name: 'Cards', op: 'count_distinct', column: 'card', by: 'week' },
    ]);
    const pick = (k: string) => out.filter((m) => m.metricKey === k).map((m) => [m.groupKey, m.groupLabel, m.value, m.rowCount]);
    expect(pick('total')).toEqual([['', null, 115, 3]]);
    expect(pick('per_driver')).toEqual([['E1', 'Name E1', 7.5, 2], ['E2', 'Name E2', null, 0]]); // the summary row has no driver
    expect(pick('days')).toEqual([['2026-07-01', null, 3, 3], ['2026-07-02', null, 1, 1]]);
    expect(pick('cards')).toEqual([['2026-W27', null, 2, 3]]);
  });

  it('counts only the rows a filter keeps (e.g. driver rows of a PDF)', () => {
    const out = computeMetrics(rows, columns, [
      { key: 'max', name: 'Max', op: 'max', column: 'gallons', by: 'file', where: { column: 'section', equals: 'driver' } },
    ]);
    expect(out).toMatchObject([{ value: 10, rowCount: 2 }]);
  });
});
