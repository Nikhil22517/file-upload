import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export type Format = 'csv' | 'xlsx' | 'pdf';
export type Grid = string[][];

/** Header normalisation: lower case, '_' as space, whitespace collapsed, trimmed. */
export const norm = (h: unknown): string =>
  String(h ?? '').replace(/﻿/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** File type from the first bytes, never from the extension. */
export function sniff(b: Buffer): Format {
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';
  return 'csv';
}

export function decodeText(b: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** Whole first sheet as text, with NO header row assumed: Netradyne exports put preamble rows above
 *  the header, so it is found later. Blank cells keep their column position; trailing empty columns go. */
export async function readGrid(b: Buffer, fmt: Exclude<Format, 'pdf'>, maxRows?: number): Promise<Grid> {
  let grid: Grid;
  if (fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(b as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const last = maxRows ? Math.min(ws.rowCount, maxRows) : ws.rowCount;
    grid = [];
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      grid.push(cells);
    }
  } else {
    const parsed = Papa.parse<string[]>(decodeText(b), { header: false, skipEmptyLines: false });
    grid = maxRows ? parsed.data.slice(0, maxRows) : parsed.data;
  }
  let width = 0;
  for (const row of grid) for (let i = row.length - 1; i >= width; i--) if (String(row[i]).trim()) { width = i + 1; break; }
  return grid.map((row) => Array.from({ length: width }, (_, i) => (row[i] == null ? '' : String(row[i]))));
}

export { amazonWeek, weekStart } from './weeks.ts';
