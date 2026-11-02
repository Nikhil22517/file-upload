/** Read an upload's first rows and what its content says about it: the DSP and station, and for PDFs the week.
 *  Which report it is comes from the workspace's templates (templates.ts), not from here. */
import { type Format, type Grid, norm, sha256 } from './common.ts';
import { pdfPages } from './pdf.ts';
import { readTable } from './table.ts';
import { findHeaderRow } from './templates.ts';

const PREVIEW_ROWS = 15;

export interface FileContext { dsp: string | null; station: string | null; source: string | null; year?: number; week?: number }
export interface Detection {
  format: Format;
  sha256: string;
  headerRow: number | null;   // best guess; a matched template's header row replaces it
  context: FileContext;
  grid: Grid | null;          // first rows of a table file, or a PDF's whole table (null: no reader for this PDF)
  reader: string | null;      // the PDF reader that produced the grid
}

/** DSP, station and (PDFs) week. Content first; the file name is only a fallback. */
function readContext(rows: Grid | null, text: string | null, fname: string, headerRow: number | null): FileContext {
  const ctx: FileContext = { dsp: null, station: null, source: null };
  if (text !== null) {
    const m = text.match(/\b([A-Z0-9]{3,5}) at ([A-Z0-9]{3,5})\b/) ?? text.match(/US - ([A-Z0-9]{3,5}) - ([A-Z0-9]{3,5})/);
    if (m) Object.assign(ctx, { dsp: m[1], station: m[2], source: 'content' });
    const w = text.match(/Week (\d{1,2})\b/);
    const y = text.match(/\b(20\d\d)\b/);
    if (w && y) Object.assign(ctx, { year: Number(y[1]), week: Number(w[1]) });
  } else if (rows) {
    for (const r of rows.slice(0, headerRow ?? 0)) { // preamble = rows ABOVE the header only
      const m = r.filter(Boolean).join(' ').match(/fleet(?: name)?:?\s+([A-Z0-9]{3,5})\b/i);
      if (m) Object.assign(ctx, { dsp: m[1], source: 'content' });
    }
    if (headerRow !== null && rows.length > headerRow + 1) {
      const cols = rows[headerRow].map(norm);
      const first = rows[headerRow + 1];
      const get = (name: string) => (cols.includes(name) ? first[cols.indexOf(name)] || null : null);
      if (get('dsp')) Object.assign(ctx, { dsp: get('dsp'), station: get('station') ?? get('service area'), source: 'content' });
    }
  }
  if (!ctx.dsp || !ctx.station) {
    const base = fname.replace(/\.[^.]+$/, '');
    const m = base.match(/(?:^|_|-)([A-Z]{4})[_-]([A-Z0-9]{4})(?:[_-]|$)/);
    if (m) {
      ctx.dsp ??= m[1];
      ctx.station ??= m[2];
      ctx.source ??= 'filename';
    } else if (!ctx.station) {
      const s = fname.match(/_([A-Z]{3}\d)_/);
      if (s) { ctx.station = s[1]; ctx.source ??= 'filename'; }
    }
  }
  return ctx;
}

export async function detect(b: Buffer, fname: string): Promise<Detection> {
  const table = await readTable(b, PREVIEW_ROWS);
  const text = table.format === 'pdf' ? (await pdfPages(b, 3)).join('\n') : null;
  const headerRow = table.grid ? findHeaderRow(table.grid) : null;
  return {
    format: table.format, sha256: sha256(b), headerRow, grid: table.grid, reader: table.reader,
    context: readContext(table.format === 'pdf' ? null : table.grid, text, fname, headerRow),
  };
}
