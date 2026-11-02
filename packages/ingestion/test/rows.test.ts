import { describe, expect, it } from 'vitest';
import { buildRows, parseCell } from '../src/rows.ts';
import { guessColumns } from '../src/templates.ts';

describe('parseCell', () => {
  it.each([
    ['1,234', 'int', 1234], ['12.5', 'decimal', 12.5], ['99.50%', 'percent', 99.5], ['a1b2c3d4', 'id', 'A1B2C3D4'],
    ['2026-07-01', 'date', '2026-07-01'], ['7/1/2026', 'date', '2026-07-01'], ['2026-07-01 09:30:00', 'datetime', '2026-07-01T09:30:00'],
    ['-2026-W27', 'week', '2026-W27'], ['Y', 'yn', true], ['no', 'yn', false],
    ['', 'int', null], ['NA', 'decimal', null], ['-', 'text', null],
    ['abc', 'int', undefined], ['soon', 'date', undefined],
  ] as const)('%s as %s', (v, type, out) => expect(parseCell(v, type)).toBe(out));
});

describe('buildRows', () => {
  const grid = [['Driver Name', 'Employee ID', 'Week', 'Gallons'], ['Ann', 'e1001', '2026-W27', '12.5'], ['', '', '', ''], ['Bob', 'e1002', '2026-W27', 'x']];
  const cols = guessColumns(grid, 0).map((c) => (c.key === 'gallons' ? { ...c, type: 'decimal' as const } : c)); // as taught

  it('keeps file line numbers, skips blank lines and records unreadable values', () => {
    const rows = buildRows(grid, 0, cols, { day: null, week: null });
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
    expect(rows[0]).toMatchObject({ driverKey: 'E1001', driverName: 'Ann', day: null, year: 2026, week: 27, data: { Gallons: 12.5 } });
    expect(rows[1].issues).toEqual([{ column: 'Gallons', value: 'x', problem: 'not a valid decimal' }]);
  });

  it('prefers the report date over a week column, and that day sets the week', () => {
    const [row] = buildRows(grid, 0, cols, { day: '2026-06-30', week: null });
    expect(row).toMatchObject({ day: '2026-06-30', year: 2026, week: 27 });
  });

  it('falls back to the week in the file name', () => {
    const noWeek = [['Driver Name', 'Gallons'], ['Ann', '3']];
    const [row] = buildRows(noWeek, 0, guessColumns(noWeek, 0), { day: null, week: { year: 2026, week: 24 } });
    expect(row).toMatchObject({ day: null, year: 2026, week: 24 });
  });
});
