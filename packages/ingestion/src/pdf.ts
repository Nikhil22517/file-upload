import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextItem { str: string; transform: number[]; width: number; hasEOL: boolean }

// pdf.js needs its bundled standard fonts on disk in Node, otherwise it warns on every page.
const STANDARD_FONTS = `${path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))}/standard_fonts/`
  .replace(/\\/g, '/');

/** Text of each page, rebuilt into lines from item positions (pdf.js returns loose text runs). */
export async function pdfPages(b: Buffer, maxPages?: number): Promise<string[]> {
  const doc = await getDocument({
    data: new Uint8Array(b), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  const pages: string[] = [];
  const n = maxPages ? Math.min(doc.numPages, maxPages) : doc.numPages;
  for (let p = 1; p <= n; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let text = '';
    let lastY: number | null = null;
    let lastEnd = 0;
    for (const raw of content.items) {
      const it = raw as TextItem;
      if (typeof it.str !== 'string') continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      else if (lastY !== null && x - lastEnd > 1 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      lastY = y;
      lastEnd = x + it.width;
      if (it.hasEOL) { text += '\n'; lastY = null; }
    }
    pages.push(text);
  }
  await doc.destroy();
  return pages;
}
