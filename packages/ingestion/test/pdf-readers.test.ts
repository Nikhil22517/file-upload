/** The PDF readers, on page text shaped like what pdf.js gives for the real Amazon PDFs (names and IDs made up). */
import { describe, expect, it } from 'vitest';
import { PDF_READER_BY_NAME, pdfReaderFor } from '../src/pdf-readers.ts';

const scorecardPages = [
  'Your Week 25 Delivery Completion DPMO ... adjusted\nDSP Delivery Excellence Performance',
  'Questions?\nPage 2 of 9',
  [
    'DSP Scorecard', 'TEST at DXX1', 'Week 25', '2026', 'Overall Standing: 70.4 | Great',
    'Poor Fair Great Fantastic Fantastic Plus', 'Safety and Compliance: Fantastic', 'i On-Road Safety Score* Fantastic',
    'i Safe Driving Metric Coming Soon', 'i Seatbelt-Off Rate 3.1 events per 100 trips | Fantastic',
    'i Breach of Contract Compliant', 'i Tenured Workforce 93.41% | Fantastic i Fleet Execution 0.00 | Fantastic',
  ].join('\n'),
  [
    'TEST at DXX1 - Week 25', '# Name Transporter ID Delivered Fico Score Seatbelt Off', 'Rate',
    '1 Ann Driver A1AAAAAAAAAAAA 644 No Data 0.0 0.0 0.0 0.0 0.0 0 0 1531.3 0 100.0% No Data 0 430',
    '2 Bob Van Driver A2BBBBBBBBBBBB 912 No Data No Data No Data No Data No Data No Data 1148 0 2183.4 0 99.5% No Data 1 556',
  ].join('\n'),
];

describe('Amazon DSP Scorecard reader', () => {
  const reader = PDF_READER_BY_NAME.amazon_dsp_scorecard;

  it('is chosen from the text', () => {
    expect(pdfReaderFor(scorecardPages.join('\n'))?.name).toBe('amazon_dsp_scorecard');
  });

  it('reads the summary values and every driver row into one table', () => {
    const [header, ...rows] = reader.read(scorecardPages);
    expect(header.slice(0, 5)).toEqual(['Section', '#', 'DA Name', 'Transporter ID', 'Delivered']);
    const at = (name: string) => header.indexOf(name);
    const summary = rows.filter((r) => r[0] === 'Summary').map((r) => [r[at('Metric')], r[at('Value')], r[at('Unit')], r[at('Status')]]);
    expect(summary).toEqual([
      ['Overall Standing', '70.4', '', 'Great'],
      ['Safety and Compliance', '', '', 'Fantastic'],
      ['On-Road Safety Score', '', '', 'Fantastic'],
      ['Safe Driving Metric', '', '', 'Coming Soon'],
      ['Seatbelt-Off Rate', '3.1', 'events per 100 trips', 'Fantastic'],
      ['Breach of Contract', '', '', 'Compliant'],
      ['Tenured Workforce', '93.41', '%', 'Fantastic'],
      ['Fleet Execution', '0.00', '', 'Fantastic'],
    ]);
    const drivers = rows.filter((r) => r[0] === 'Driver');
    expect(drivers.map((r) => [r[at('DA Name')], r[at('Transporter ID')], r[at('Delivered')], r[at('FICO Score')], r[at('POD')], r[at('POD Opps')]]))
      .toEqual([['Ann Driver', 'A1AAAAAAAAAAAA', '644', '', '100.0%', '430'], ['Bob Van Driver', 'A2BBBBBBBBBBBB', '912', '', '99.5%', '556']]);
  });
});

describe('Amazon POD Details reader', () => {
  const pages = [
    ['Photo on Delivery Acceptance Rate Report', 'US - TEST - DXX1 - Week 25', 'POD SUMMARY', 'Category Photo Count % of Total Opportunities',
      'Success 48557 99.74%', 'Rejects 88 0.18%', 'Rejects Category Breakdown', 'Category Photo Count % of Total Rejects',
      'Blurry Photo 50 56.82%', 'Package Not Clearly Visible', '(Locker/Other Concealment) 5 5.68%', 'Page 1/8'].join('\n'),
    ['Photo on Delivery Acceptance Rate Report (DA Level)', 'Employee Name Transporter Id',
      'Ann Marie Driver A1AAAAAAAAAAAA 430 430 0 0 0 0 0 0 0 0 0 0 0',
      'Bob Driver A2BBBBBBBBBBBB 723 722 0 1 0 0 0 0 0 0 1 0 0'].join('\n'),
  ];

  it('reads the company summary, the rejects breakdown and every driver', () => {
    const reader = pdfReaderFor(pages.join('\n'))!;
    expect(reader.name).toBe('amazon_pod_details');
    const [header, ...rows] = reader.read(pages);
    const at = (name: string) => header.indexOf(name);
    expect(rows.filter((r) => r[0] !== 'Driver').map((r) => [r[0], r[at('Metric')], r[at('Count')], r[at('Percent')]])).toEqual([
      ['POD summary', 'Success', '48557', '99.74%'], ['POD summary', 'Rejects', '88', '0.18%'],
      ['Rejects breakdown', 'Blurry Photo', '50', '56.82%'],
      ['Rejects breakdown', 'Package Not Clearly Visible (Locker/Other Concealment)', '5', '5.68%'],
    ]);
    expect(rows.filter((r) => r[0] === 'Driver').map((r) => [r[at('Employee Name')], r[at('Transporter Id')], r[at('Opportunities')], r[at('Rejects')]]))
      .toEqual([['Ann Marie Driver', 'A1AAAAAAAAAAAA', '430', '0'], ['Bob Driver', 'A2BBBBBBBBBBBB', '723', '1']]);
  });

  it('leaves PDFs it does not know alone', () => {
    expect(pdfReaderFor('Invoice 1234 Total due')).toBeNull();
  });
});
