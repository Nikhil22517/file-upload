/**
 * PDF readers: turn a PDF whose layout we know into a table (a header row, then rows), so it goes through the
 * same template, column type and row steps as a CSV. A PDF no reader recognises is stored as a file only.
 *
 * Each table has a Section column: 'Driver' rows hold one driver's values; 'Summary' rows hold the report-level
 * values (overall standing, each metric with its tier...), one per row, in the Metric / Value / Unit / Status columns.
 * Adding a layout = adding a reader here.
 */
import type { Grid } from './common.ts';

export interface PdfReader {
  name: string;
  label: string;
  sections: string[];                   // values of the Section column it writes, for templates to choose from
  matches(text: string): boolean;      // text of the first pages
  read(pages: string[]): Grid;          // header row first
}

const lines = (page: string) => page.split('\n').map((l) => l.trim()).filter(Boolean);
const NO_VALUE = /^(no data|coming soon|n\/a|-)$/i;
const clean = (v: string) => (NO_VALUE.test(v.trim()) ? '' : v.trim());
const TID = '(A[A-Z0-9]{9,15})';         // Amazon transporter ID

// ---------------- Amazon DSP Scorecard (weekly) ----------------
const SCORECARD_METRICS = ['Delivered', 'FICO Score', 'Seatbelt Off Rate', 'Speeding Event Rate', 'Distractions Rate',
  'Following Distance Rate', 'Sign/Signal Violations Rate', 'CDF DPMO', 'CED', 'DC DPMO', 'DSB', 'POD', 'PSB',
  'DSB Count', 'POD Opps'];
const SUMMARY_COLS = ['Metric', 'Value', 'Unit', 'Status'];
const TIERS = 'Fantastic Plus|Fantastic|Great|Fair|Poor|Coming Soon|Compliant|Non-Compliant|Not Compliant|No Data';

/** '# Name TransporterID' then the 15 metrics; 'No Data' is one value. */
const DA_ROW = new RegExp(`^(\\d+)\\s+(.+?)\\s+${TID}\\s+(.+)$`);

function scorecardSummary(page: string): string[][] {
  const out: string[][] = [];
  for (const raw of lines(page)) {
    for (const part of raw.split(/\s+i\s+/)) { // two metrics can share a line: '... | Fantastic i Fleet Execution ...'
      const l = part.replace(/^i\s+/, '').trim();
      let m = l.match(/^(.+?):?\s+(-?[\d.,]+)(%?)\s*(.*?)\s*\|\s*(.+)$/); // 'Seatbelt-Off Rate 3.1 events per 100 trips | Fantastic'
      if (m) { out.push([m[1].replace(/\*$/, ''), m[2].replace(/,/g, ''), m[3] || m[4], m[5]]); continue; }
      m = l.match(new RegExp(`^(.+?):?\\s+(${TIERS})$`));              // 'Safety and Compliance: Fantastic', 'Breach of Contract Compliant'
      if (m && !/^(poor|fair|great|fantastic)\b/i.test(m[1])) out.push([m[1].replace(/\*$/, ''), '', '', m[2]]);
    }
  }
  return out;
}

const dspScorecard: PdfReader = {
  name: 'amazon_dsp_scorecard',
  label: 'Amazon DSP Scorecard',
  sections: ['Driver', 'Summary'],
  matches: (t) => /DSP Scorecard/.test(t) && /Overall Standing/.test(t),
  read(pages) {
    const header = ['Section', '#', 'DA Name', 'Transporter ID', ...SCORECARD_METRICS, ...SUMMARY_COLS];
    const blankDa = Array(3 + SCORECARD_METRICS.length).fill('');
    const rows: Grid = [header];
    const summaryPage = pages.find((p) => /Overall Standing:/.test(p));
    if (summaryPage) for (const s of scorecardSummary(summaryPage)) rows.push(['Summary', ...blankDa, ...s]);
    for (const page of pages) {
      for (const l of lines(page)) {
        const m = l.match(DA_ROW);
        if (!m) continue;
        const values = m[4].match(/No Data|Coming Soon|\S+/g) ?? [];
        if (values.length !== SCORECARD_METRICS.length) continue; // not a driver row after all
        rows.push(['Driver', m[1], m[2], m[3], ...values.map(clean), '', '', '', '']);
      }
    }
    return rows;
  },
};

// ---------------- Amazon POD Details (weekly) ----------------
const POD_COUNTS = ['Opportunities', 'Success', 'Bypass', 'Rejects', 'Blurry Photo', 'Human In The Picture',
  'No Package Detected', 'Package In Car', 'Package In Hand', 'Package Not Clearly Visible', 'Package Too Close',
  'Photo Too Dark', 'Other'];
const POD_ROW = new RegExp(`^(.+?)\\s+${TID}\\s+((?:\\d+\\s+){12}\\d+)$`);
const POD_SUMMARY = /^(.+?)\s+(\d+)\s+([\d.]+%)$/;          // 'Blurry Photo 50 56.82%'

const podDetails: PdfReader = {
  name: 'amazon_pod_details',
  label: 'Amazon POD Details',
  sections: ['Driver', 'POD summary', 'Rejects breakdown'],
  matches: (t) => /Photo on Delivery Acceptance Rate Report/i.test(t),
  read(pages) {
    const header = ['Section', 'Employee Name', 'Transporter Id', ...POD_COUNTS, 'Metric', 'Count', 'Percent'];
    const blankDa = Array(2 + POD_COUNTS.length).fill('');
    const rows: Grid = [header];
    const first = pages[0] ?? '';
    let section = 'POD summary';
    let pending = '';                                           // a category name wrapped onto the next line
    for (const l of lines(first)) {
      if (/Rejects Category Breakdown/i.test(l)) { section = 'Rejects breakdown'; continue; }
      const m = (pending ? `${pending} ${l}` : l).match(POD_SUMMARY);
      if (m) { rows.push([section, ...blankDa, m[1], m[2], m[3]]); pending = ''; continue; }
      pending = /^(Category|Page|POD SUMMARY|Photo on Delivery|US -)/i.test(l) ? '' : l;
    }
    for (const page of pages.slice(1)) {
      for (const l of lines(page)) {
        const m = l.match(POD_ROW);
        if (m) rows.push(['Driver', m[1].replace(/\s+/g, ' '), m[2], ...m[3].trim().split(/\s+/), '', '', '']);
      }
    }
    return rows;
  },
};

export const PDF_READERS: PdfReader[] = [dspScorecard, podDetails];
export const PDF_READER_BY_NAME: Record<string, PdfReader> = Object.fromEntries(PDF_READERS.map((r) => [r.name, r]));

/** The reader for a PDF, chosen from the text of its first pages. */
export const pdfReaderFor = (text: string): PdfReader | null => PDF_READERS.find((r) => r.matches(text)) ?? null;
