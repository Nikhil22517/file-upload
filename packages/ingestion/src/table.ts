/** Any upload as a table: CSV and XLSX read directly, a PDF through the reader for its layout (pdf-readers.ts). */
import { type Format, type Grid, readGrid, sniff } from './common.ts';
import { pdfPages } from './pdf.ts';
import { pdfReaderFor } from './pdf-readers.ts';

export interface Table {
  format: Format;
  grid: Grid | null;        // null: a PDF no reader recognises (stored as a file only)
  reader: string | null;    // the PDF reader used
}

/** `maxRows` limits table files (a preview); a PDF's table is always whole, since its summary rows come first. */
export async function readTable(b: Buffer, maxRows?: number): Promise<Table> {
  const format = sniff(b);
  if (format !== 'pdf') return { format, grid: await readGrid(b, format, maxRows), reader: null };
  const pages = await pdfPages(b);
  const reader = pdfReaderFor(pages.slice(0, 3).join('\n'));
  return { format, grid: reader ? reader.read(pages) : null, reader: reader?.name ?? null };
}
