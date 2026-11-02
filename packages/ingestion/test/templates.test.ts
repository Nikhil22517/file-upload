import { describe, expect, it } from 'vitest';
import { draftTemplate, matchTemplate, parseFileName } from '../src/templates.ts';

describe('parseFileName', () => {
  it.each([
    ['Quality_Overview_PTLG_DNJ4_2026-07-01 (1).csv', 'PTLG', 'quality_overview_{dsp}_{station}_{date}', { date: '2026-07-01', dsp: 'PTLG', station: 'DNJ4' }],
    ['Quality_Overview_PAYA_DYY6_2026-06-28.csv', 'PAYA', 'quality_overview_{dsp}_{station}_{date}', { date: '2026-06-28', dsp: 'PAYA' }],
    ['DSP_Associates_Concessions_DNJ4_ - 2026-07-02T100442.178.csv', 'PTLG', 'dsp_associates_concessions_{station}',
      { exportedAt: '2026-07-02', referenceDate: '2026-07-01' }],
    ['DSP_Associates_Concessions_DYY6_ (7).csv', 'PAYA', 'dsp_associates_concessions_{station}', { referenceDate: null }],
    ['All Alerts Report( Jul 01 2026 ) (6).xlsx', 'PTLG', 'all_alerts_report_{date}', { date: '2026-07-01' }],
    ['Drivers-Report(Jul-02-2026) (14).csv', 'PTLG', 'drivers_report_{date}', { date: '2026-07-02' }],
    ['DSP_Customer_Delivery_Feedback_negative_DYY6_2026-W24.csv', 'PAYA', 'dsp_customer_delivery_feedback_negative_{station}_{week}',
      { week: { year: 2026, week: 24 }, date: null }],
    ['US_PAYA_DYY6_WEEK25_2026_tenure_workforce_das_Report.csv', 'PAYA', 'us_{dsp}_{station}_{week}_tenure_workforce_das_report',
      { week: { year: 2026, week: 25 } }],
    ['US_OTAD_DAT9_WEEK26_2026_Escalations_(Infractions)_Report (1).csv', 'PTLG', 'us_{dsp}_{station}_{week}_escalations_infractions_report',
      { dsp: 'OTAD' }],
    ['US-PTLG-DNJ4-Week26-2026NA-DA-POD-Details (1).pdf', 'PTLG', 'us_{dsp}_{station}_{week}_na_da_pod_details', {}],
    ['fuel_log_october.csv', 'PTLG', 'fuel_log_october', { date: null, week: null }],
  ])('%s', (name, ws, pattern, values) => {
    const info = parseFileName(name, ws);
    expect(info.pattern).toBe(pattern);
    expect(info).toMatchObject(values);
  });

  it('gives the same pattern for every day and every client', () => {
    expect(parseFileName('Fuel_Log_PTLG_DNJ4_2026-07-01.csv', 'PTLG').pattern)
      .toBe(parseFileName('Fuel_Log_PAYA_DYY6_2026-08-15 (3).csv', 'PAYA').pattern);
  });
});

const FUEL = [
  ['Fuel log export', '', '', ''],          // preamble above the header
  ['Driver Name', 'Employee ID', 'Fill Date', 'Gallons'],
  ['Ann Driver', 'E1001', '2026-07-01', '12.5'],
  ['Bob Driver', 'E1002', '2026-07-01', '9'],
];

describe('draftTemplate', () => {
  it('finds the header below a preamble and guesses types and roles', () => {
    const d = draftTemplate(FUEL, 'Fuel_Log_PTLG_2026-07-01.csv', 'PTLG');
    expect(d.headerRow).toBe(1);
    expect(d.name).toBe('Fuel Log');
    expect(d.columns.map((c) => [c.key, c.type, c.role])).toEqual([
      ['driver name', 'text', 'driver_name'],
      ['employee id', 'id', 'driver_id'],
      ['fill date', 'date', 'date'],
      ['gallons', 'decimal', null],
    ]);
    expect(d.periodSource).toBe('column');
    expect(d.sampleRows).toHaveLength(2);
  });

  it('skips a merged title row and reads "NA" as blank (Netradyne All Alerts)', () => {
    const title = 'Alerts Report (Generated 02 Jul 2026)';
    const grid = [[title, title, title], ['Driver Name', 'Driver Id', 'Score'], ['Ann', 'D-1', 'NA'], ['Bob', 'D-2', '997']];
    const d = draftTemplate(grid, 'All Alerts Report( Jul 01 2026 ).xlsx');
    expect(d.headerRow).toBe(1);
    expect(d.columns.map((c) => [c.key, c.type, c.role])).toEqual([
      ['driver name', 'text', 'driver_name'], ['driver id', 'text', 'driver_id'], ['score', 'int', null]]);
  });

  it('gives the driver ID role to a "Delivery Associate" column holding IDs (Amazon concessions)', () => {
    const grid = [['Delivery Associate Name', 'Delivery Associate', 'da_name'], ['Ann Driver', 'A1AAAAAAAAAAAA', 'Ann']];
    expect(draftTemplate(grid, 'x.csv').columns.map((c) => c.role)).toEqual(['driver_name', 'driver_id', null]);
  });

  it('asks for a date only when neither the columns nor the file name have one', () => {
    const noDate = [['Driver Name', 'Gallons'], ['Ann', '12.5']];
    expect(draftTemplate(noDate, 'fuel_log.csv').periodSource).toBe('ask');
    expect(draftTemplate(noDate, 'fuel_log_2026-07-01.csv').periodSource).toBe('filename');
  });
});

describe('matchTemplate', () => {
  const t = { id: 't1', name: 'Fuel Log', format: 'csv', headerRow: 1, fileNamePattern: 'fuel_log_{dsp}_{date}',
    headers: ['driver name', 'employee id', 'fill date', 'gallons'] };

  it('matches the same columns in any order', () => {
    const grid = [[], ['Gallons', 'Fill Date', 'Employee ID', 'Driver Name']];
    expect(matchTemplate(grid, 'csv', 'whatever', [t])).toEqual({ kind: 'exact', template: t, headerRow: 1 });
  });

  it('flags changed columns for confirmation', () => {
    const grid = [[], ['Driver Name', 'Employee ID', 'Fill Date', 'Gallons', 'Cost']];
    expect(matchTemplate(grid, 'csv', 'fuel_log_{dsp}_{date}', [t])).toEqual({ kind: 'changed', template: t, headerRow: 1, added: ['cost'], missing: [] });
  });

  it('uses the file name to choose between templates with the same columns', () => {
    const other = { ...t, id: 't2', name: 'Fuel Log B', fileNamePattern: 'fuel_b_{date}' };
    const grid = [[], ['Driver Name', 'Employee ID', 'Fill Date', 'Gallons']];
    expect(matchTemplate(grid, 'csv', 'fuel_b_{date}', [t, other])?.template.id).toBe('t2');
  });

  it('finds the header on another row when the rows above it change', () => {
    const grid = [['Fleet Name', 'PTLG'], ['Duration', '1 day'], [], ['Driver Name', 'Employee ID', 'Fill Date', 'Gallons']];
    expect(matchTemplate(grid, 'csv', 'x', [t])).toMatchObject({ kind: 'exact', headerRow: 3 });
  });

  it('does not match an unrelated report', () => {
    expect(matchTemplate([[], ['Route', 'Stops']], 'csv', 'routes', [t])).toBeNull();
  });
});
