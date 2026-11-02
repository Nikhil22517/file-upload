/**
 * Turn a table file into rows: every value parsed by its column's type, plus the driver and the day
 * each row is about, as the report's template describes its columns.
 */
import { type Grid, amazonWeek, norm } from './common.ts';
import type { ColumnSpec, ColumnType } from './columns.ts';
import { BLANK } from './templates.ts';

export type CellValue = string | number | boolean | null;
export interface RowIssue { column: string; value: string; problem: string }
export interface ParsedRow {
  line: number;                 // 1-based line in the file, as a person would count it
  driverKey: string | null;     // value of the driver_id column
  driverName: string | null;    // value of the driver_name column
  day: string | null;
  year: number | null;          // Amazon week of the day, or the week the row or file names
  week: number | null;
  data: Record<string, CellValue>;
  issues: RowIssue[];
}

const pad = (n: number | string) => String(n).padStart(2, '0');
const usDate = (s: string) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/); // four-digit year first, or 2026 reads as 20
  return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}` : null;
};

/** One cell as JSON. null = empty; undefined = could not be read as this type. */
export function parseCell(v: string, type: ColumnType): CellValue | undefined {
  const s = v.trim();
  if (!s || BLANK.test(s)) return null;
  switch (type) {
    case 'text': return s;
    case 'id': return s.toUpperCase();
    case 'int':
    case 'decimal': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'percent': {
      const n = Number(s.replace(/\s*%$/, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date': {
      const d = s.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? usDate(s);
      return d && !Number.isNaN(Date.parse(d)) ? d : undefined;
    }
    case 'datetime': {
      const d = s.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? usDate(s);
      const t = s.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?/)?.[0];
      return d && !Number.isNaN(Date.parse(d)) ? (t ? `${d}T${t}` : d) : undefined;
    }
    case 'week': {
      const m = s.match(/(\d{4})-?W(\d{1,2})/i); // 2026-W26, -2026-W27
      return m ? `${m[1]}-W${pad(m[2])}` : undefined;
    }
    case 'yn': return ({ y: true, yes: true, true: true, 1: true, n: false, no: false, false: false, 0: false } as Record<string, boolean>)[s.toLowerCase()];
  }
}

/** For rows without a date column: the report date (chosen, or from the file name), else the report week. */
export interface FilePeriod { day: string | null; week: { year: number; week: number } | null }

/** What a template keeps: `sections` limits rows to these values of a 'Section' column (PDF readers write one). */
export interface RowOptions { sections?: string[] | null }

export function buildRows(grid: Grid, headerRow: number, columns: ColumnSpec[], file: FilePeriod, opts: RowOptions = {}): ParsedRow[] {
  const header = (grid[headerRow] ?? []).map(norm);
  const used = new Set<number>();
  const names = new Set<string>();
  const placed = columns.flatMap((col) => { // a header can repeat ('undefined' x3): each spec takes the next one
    const i = header.findIndex((h, j) => h === col.key && !used.has(j));
    if (i < 0) return [];
    used.add(i);
    let name = col.header;
    for (let n = 2; names.has(name); n++) name = `${col.header} (${n})`;
    names.add(name);
    return [{ ...col, i, name }];
  });

  const sectionAt = header.indexOf('section');
  const keep = opts.sections?.length && sectionAt >= 0 ? new Set(opts.sections.map((x) => x.toLowerCase())) : null;

  const rows: ParsedRow[] = [];
  grid.forEach((cells, r) => {
    if (r <= headerRow || !cells.some((c) => c.trim())) return;
    if (keep && !keep.has((cells[sectionAt] ?? '').trim().toLowerCase())) return;
    const row: ParsedRow = { line: r + 1, driverKey: null, driverName: null, day: null, year: null, week: null, data: {}, issues: [] };
    for (const col of placed) {
      const raw = cells[col.i] ?? '';
      let v = parseCell(raw, col.type);
      if (v === undefined) {
        if (col.include !== false) row.issues.push({ column: col.name, value: raw, problem: `not a valid ${col.type}` });
        v = null;
      }
      if (col.include !== false) row.data[col.name] = v; // a skipped column still gives its role (driver, date)
      if (v === null) continue;
      if (col.role === 'driver_id') row.driverKey ??= String(v);
      if (col.role === 'driver_name') row.driverName ??= String(v);
      if (col.role === 'date') row.day ??= String(v).slice(0, 10);
      if (col.role === 'week' && row.year === null) [row.year, row.week] = String(v).split('-W').map(Number);
    }
    // the day: the row's date column, else the file's report date; the week alone only when there is no day
    row.day ??= file.day;
    if (!row.day && row.year === null && file.week) [row.year, row.week] = [file.week.year, file.week.week];
    if (row.day) ({ year: row.year, week: row.week } = amazonWeek(row.day));
    rows.push(row);
  });
  return rows;
}
