/**
 * Report templates a user teaches once: the first upload of an unknown report shows a draft
 * (header row, column types, driver and date columns, all guessed); the user confirms it, and later
 * uploads of the same report are recognised by their headers and file-name pattern.
 */
import { createHash } from 'node:crypto';
import { type ColumnRole, type ColumnSpec, type ColumnType, type PeriodKind, type PeriodSource, periodSourceOf } from './columns.ts';
import { type Format, type Grid, norm } from './common.ts';
import { PDF_READER_BY_NAME } from './pdf-readers.ts';
import { readTable } from './table.ts';

// ---------------- file names ----------------
export interface FileNameInfo {
  pattern: string;                    // e.g. quality_overview_{dsp}_{station}_{date}
  date: string | null;                // a day in the name
  week: { year: number; week: number } | null;
  exportedAt: string | null;          // day of an export timestamp ('2026-07-02T100442.178')
  dsp: string | null;
  station: string | null;
  referenceDate: string | null;       // suggested report date: the day in the name, else the day before the export
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number | string) => String(n).padStart(2, '0');

/** Split a file name into its fixed part (the pattern) and the parts that change per upload.
 *  'Quality_Overview_PTLG_DNJ4_2026-07-01 (1).csv' -> quality_overview_{dsp}_{station}_{date}, date 2026-07-01. */
export function parseFileName(fname: string, wsCode?: string): FileNameInfo {
  const out: FileNameInfo = { pattern: '', date: null, week: null, exportedAt: null, dsp: null, station: null, referenceDate: null };
  let s = fname.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/\s*\(\d+\)\s*$/, ''); // extension, browser copy suffix ' (1)'
  // export timestamps differ on every download, so they are not part of the pattern at all
  s = s.replace(/[\s_-]*(\d{4}-\d{2}-\d{2})T\d{6}(?:\.\d+)?/, (_, d: string) => { out.exportedAt = d; return ' '; });
  s = s.replace(/(20\d\d)-W(\d{1,2})(?!\d)/i, (_, y: string, w: string) => {
    out.week = { year: Number(y), week: Number(w) }; return ' {week} ';
  });
  s = s.replace(/week[_\s-]?(\d{1,2})[_\s-]?(20\d\d)/i, (_, w: string, y: string) => {
    out.week ??= { year: Number(y), week: Number(w) }; return ' {week} ';
  });
  s = s.replace(/(20\d\d)-(\d\d)-(\d\d)/, (_, y: string, m: string, d: string) => { out.date = `${y}-${m}-${d}`; return ' {date} '; });
  s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+(\d{1,2})[\s,-]+(20\d\d)/i,
    (_, mon: string, d: string, y: string) => {
      out.date ??= `${y}-${pad(MONTHS.indexOf(mon.toLowerCase()) + 1)}-${pad(d)}`; return ' {date} ';
    });
  s = s.replace(/(?<=^|[_\s-])([A-Z]{3}\d)(?=$|[_\s-])/, (_, st: string) => { out.station = st; return ' {station} '; });
  if (wsCode) {
    s = s.replace(new RegExp(`(?<=^|[_\\s-])${wsCode}(?=$|[_\\s-])`), () => { out.dsp = wsCode; return ' {dsp} '; });
  }
  s = s.replace(/(?<=^|[_\s-])([A-Z]{4})(?=[_\s-]+\{station\})/, (_, dsp: string) => { out.dsp ??= dsp; return ' {dsp} '; });
  out.pattern = s.toLowerCase().replace(/[^a-z0-9{}]+/g, '_').replace(/^_+|_+$/g, '');
  if (out.date) out.referenceDate = out.date;
  else if (out.exportedAt) { // exports named with their export time cover the prior day
    const d = new Date(`${out.exportedAt}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    out.referenceDate = d.toISOString().slice(0, 10);
  }
  return out;
}

// ---------------- columns ----------------

const NUMERIC = /^-?[\d,]*\.?\d+%?$/;
const DATEISH = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;

/** The header is the first row about as wide as the table whose cells are mostly words, not values
 *  (Netradyne exports put preamble rows above it). Width counts distinct cells: a merged title cell
 *  comes back repeated across every column. */
export function findHeaderRow(grid: Grid): number {
  const filled = grid.map((r) => [...new Set(r.map((c) => c.trim()).filter(Boolean))]);
  const widest = Math.max(0, ...filled.map((r) => r.length));
  const i = filled.findIndex((cells) => cells.length >= Math.max(2, 0.6 * widest)
    && cells.filter((c) => NUMERIC.test(c) || DATEISH.test(c)).length < cells.length / 2);
  return Math.max(0, i);
}

export const BLANK = /^(na|n\/a|-+|null|none)$/i; // placeholders exports write for "no value"

export function guessType(values: string[]): ColumnType {
  const vs = values.map((v) => v.trim()).filter((v) => v && !BLANK.test(v));
  if (!vs.length) return 'text';
  const all = (re: RegExp) => vs.every((v) => re.test(v));
  if (all(/^-?\d+(\.\d+)?\s*%$/)) return 'percent';
  if (all(/^-?\d{4}-W\d{1,2}$/i)) return 'week';
  if (all(/^\d{4}-\d{2}-\d{2}$/) || all(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) return 'date';
  if (all(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})[ T]\d{1,2}:\d{2}/)) return 'datetime';
  if (all(/^-?\d{1,9}$/)) return 'int';
  if (all(/^-?[\d,]*\.\d+$/) || all(/^-?\d+(\.\d+)?$/)) return 'decimal';
  if (all(/^(y|n|yes|no|true|false)$/i)) return 'yn';
  if (all(/^(?=.*\d)(?=.*[a-z])[a-z0-9]{4,}$/i)) return 'id'; // codes mixing letters and digits: A1AAAAAAAAAAAA, E1001
  return 'text';
}

const DRIVERISH = /driver|associate|employee|transporter|\bda\b/;
const IDISH = /\bid\b|number/;

/** Guessed column specs for a header row. The driver ID is the driver-ish column holding IDs
 *  (a transporter ID first), the driver name the driver-ish column holding words; each role goes to one column. */
export function guessColumns(grid: Grid, headerRow: number): ColumnSpec[] {
  const header = grid[headerRow] ?? [];
  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => c.trim()));
  const cols: ColumnSpec[] = header.flatMap((h, i) => {
    const key = norm(h);
    return key ? [{ header: h.trim(), key, type: guessType(body.map((r) => r[i] ?? '')), role: null }] : [];
  });
  const first = (ok: (c: ColumnSpec) => boolean) => cols.find((c) => !c.role && ok(c));
  const assign = (c: ColumnSpec | undefined, role: ColumnRole) => { if (c) c.role = role; };
  const driverId = (c: ColumnSpec) => DRIVERISH.test(c.key) && (c.type === 'id' || IDISH.test(c.key));
  assign(first((c) => driverId(c) && /transporter/.test(c.key)) ?? first(driverId), 'driver_id');
  assign(first((c) => DRIVERISH.test(c.key) && c.type === 'text' && !IDISH.test(c.key)), 'driver_name');
  assign(first((c) => (c.type === 'date' || c.type === 'datetime') && /date|day/.test(c.key))
    ?? first((c) => c.type === 'date'), 'date');
  assign(first((c) => c.type === 'week'), 'week');
  return cols;
}

/** Order-independent fingerprint of a header row. */
export const headerSignature = (keys: string[]): string =>
  createHash('sha256').update([...new Set(keys)].sort().join('\n')).digest('hex');

// ---------------- draft and matching ----------------
export interface TemplateDraft {
  name: string;
  headerRow: number | null;
  columns: ColumnSpec[];
  sampleRows: string[][];
  samples: Record<string, string[]>;  // per column key: its first few non-blank values, for showing next to the column
  fileNamePattern: string;
  periodSource: PeriodSource;
  periodKind: PeriodKind;              // guessed: a week column or a week in the file name -> week, else day
  reader: string | null;               // the PDF reader that turns this report into a table
  sections: string[];                  // the reader's sections (Driver, Summary...), to choose which to keep
}

/** First rows of a table file, or a PDF's whole table, for drafting and matching (null: no reader for this PDF). */
export async function previewGrid(b: Buffer, rows = 15): Promise<Grid | null> {
  return (await readTable(b, rows)).grid;
}

const ACRONYMS = new Set(['dsp', 'da', 'na', 'pod', 'rts', 'cdf', 'dsb', 'dnr', 'id', 'kpi']);

/** 'us_{dsp}_{station}_{week}_na_da_pod_details' -> 'NA DA POD Details'. */
const nameFromPattern = (p: string) => p.replace(/\{\w+\}/g, '_').split(/_+/).filter(Boolean)
  .filter((w, i, all) => !(i === 0 && w === 'us' && all.length > 1)) // Amazon's country prefix
  .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
  .join(' ');

/** A week column, or a week in the file name with no date column, means a weekly report. */
export const periodKindOf = (columns: ColumnSpec[], fileNamePattern: string): PeriodKind =>
  columns.some((c) => c.role === 'week') || (/\{week\}/.test(fileNamePattern) && !columns.some((c) => c.role === 'date')) ? 'week' : 'day';

export function draftTemplate(grid: Grid | null, fname: string, wsCode?: string, headerRow?: number, reader: string | null = null): TemplateDraft {
  const fileNamePattern = parseFileName(fname, wsCode).pattern;
  if (!grid) {
    return {
      name: nameFromPattern(fileNamePattern), headerRow: null, columns: [], sampleRows: [], samples: {}, fileNamePattern,
      periodSource: periodSourceOf([], fileNamePattern), periodKind: periodKindOf([], fileNamePattern), reader, sections: [],
    };
  }
  const hr = headerRow ?? findHeaderRow(grid);
  const columns = guessColumns(grid, hr);
  const body = grid.slice(hr + 1).filter((r) => r.some((c) => c.trim()));
  return {
    name: nameFromPattern(fileNamePattern), headerRow: hr, columns,
    sampleRows: body.slice(0, 5),
    samples: Object.fromEntries(columns.map((c) => {
      const at = (grid[hr] ?? []).findIndex((h) => norm(h) === c.key); // header cells can be blank, so look the column up
      return [c.key, body.map((r) => (r[at] ?? '').trim()).filter((v) => v && !BLANK.test(v)).slice(0, 3)];
    })),
    fileNamePattern, periodSource: periodSourceOf(columns, fileNamePattern), periodKind: periodKindOf(columns, fileNamePattern), reader,
    sections: reader ? PDF_READER_BY_NAME[reader]?.sections ?? [] : [],
  };
}

export interface TemplateLike { id: string; name: string; format: string; headerRow: number | null; headers: string[]; fileNamePattern: string }
export type TemplateMatch<T> =
  | { kind: 'exact'; template: T; headerRow: number | null }
  | { kind: 'changed'; template: T; headerRow: number | null; added: string[]; missing: string[] };

const SEARCH_ROWS = 15;

/** Same headers -> exact (the file name breaks ties between templates with identical columns).
 *  Mostly the same headers, or the same file name with half of them -> changed, for the user to confirm.
 *  The header is looked for in the template's row first, then in the first rows of the file, so a report whose
 *  preamble grows or shrinks (Netradyne) still matches; `headerRow` says where it was found. */
export function matchTemplate<T extends TemplateLike>(grid: Grid | null, format: Format, fileNamePattern: string, templates: T[]): TemplateMatch<T> | null {
  if (!grid) { // a PDF no reader understands: the file name is all there is
    const t = templates.find((x) => x.format === 'pdf' && x.headerRow === null && x.fileNamePattern === fileNamePattern);
    return t ? { kind: 'exact', template: t, headerRow: null } : null;
  }
  const exact: { t: T; row: number; nameHit: boolean }[] = [];
  let best: { t: T; row: number; score: number; added: string[]; missing: string[] } | null = null;
  for (const t of templates) {
    if (t.headerRow === null || (t.format === 'pdf') !== (format === 'pdf')) continue;
    const want = new Set(t.headers);
    const nameHit = t.fileNamePattern === fileNamePattern;
    const rows = [t.headerRow, ...Array.from({ length: Math.min(SEARCH_ROWS, grid.length) }, (_, i) => i).filter((i) => i !== t.headerRow)];
    let rowBest: { row: number; score: number; added: string[]; missing: string[] } | null = null;
    for (const row of rows) {
      const found = new Set((grid[row] ?? []).map(norm).filter(Boolean));
      if (!found.size) continue;
      const added = [...found].filter((h) => !want.has(h));
      const missing = [...want].filter((h) => !found.has(h));
      const score = (want.size - missing.length) / (want.size + added.length);
      if (!rowBest || score > rowBest.score) rowBest = { row, score, added, missing };
      if (score === 1) break;
    }
    if (!rowBest) continue;
    if (rowBest.score === 1) { exact.push({ t, row: rowBest.row, nameHit }); continue; }
    if (rowBest.score >= 0.8 || (nameHit && rowBest.score >= 0.5)) {
      const score = rowBest.score + (nameHit ? 0.1 : 0);
      if (!best || score > best.score) best = { t, ...rowBest, score };
    }
  }
  if (exact.length) {
    const e = exact.find((x) => x.nameHit) ?? exact[0];
    return { kind: 'exact', template: e.t, headerRow: e.row };
  }
  return best ? { kind: 'changed', template: best.t, headerRow: best.row, added: best.added, missing: best.missing } : null;
}
