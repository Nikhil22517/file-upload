/**
 * End-to-end tests of file upload against a real Postgres (start it with `docker compose up -d`).
 * They use small generated files, not client data, and a fresh workspace per test.
 */
import { existsSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pool, runMigrations } from '@platform/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import { config } from '../src/config.ts';

// stands in for the caller's own storage (S3, ...) for uploads by URL
const hosted = new Map<string, string>();
let fileServer: Server;
let hostUrl = '';
beforeAll(async () => {
  await runMigrations();
  fileServer = createServer((req, res) => {
    const body = hosted.get(req.url ?? '');
    res.writeHead(body === undefined ? 404 : 200).end(body);
  });
  await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', r));
  hostUrl = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;
});
afterAll(async () => { await pool.end(); fileServer.close(); });
const host = (p: string, content: string) => { hosted.set(p, content); return hostUrl + p; };

const json = async (path: string, init?: RequestInit) => {
  const res = await app.request(path, init);
  return { status: res.status, body: await res.json() as any };
};
const post = (path: string, data: unknown) =>
  json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
async function newWorkspace(prefix = 'T') {
  return (await post('/workspaces', { code: prefix + letters(3), name: 'Test' })).body; // 4 letters, like a DSP code
}

async function upload(ws: any, name: string, content: string, form: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('files', new File([content], name));
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  const r = await json(`/workspaces/${ws.id}/files`, { method: 'POST', body: fd });
  expect(r.status).toBe(201);
  return r.body[0];
}

const QUALITY = [
  '"Date","Delivery Associate ","Transporter ID","Packages Delivered","Routes Completed",'
  + '"Packages Returned to Station - DA Controllable","POD","DSB Count"',
  '"2026-07-01","Ann Driver","A1AAAAAAAAAAAA","200","1","2","99.50%","0"',
].join('\n');
const ASSOC_BROKEN = [ // Amazon's broken export: three headers literally "undefined"
  '"Week","Delivery Associate Name","Delivery Associate ID","Delivered Packages",'
  + '"Packages Delivered Not Received (DNR)","DSB Count","Dispatched Packages","undefined","undefined %","undefined"',
  '"-2026-W27","Ann Driver","A1AAAAAAAAAAAA","200","0","","201","1","0.5%","4975"',
].join('\n');
const qualityName = (ws: any, day = '2026-07-01') => `Quality_Overview_${ws.code}_DXX1_${day}.csv`;

/** Upload a file and teach its template, as a user would on first meeting the report. */
async function teach(ws: any, name: string, content: string, template: Record<string, unknown> = {}) {
  const r = await upload(ws, name, content);
  expect(r.stage).toBe('needs_template');
  const t = await post(`/workspaces/${ws.id}/templates`, { file_id: r.id, ...template });
  expect(t.status).toBe(201);
  return { upload: r, template: t.body.template, files: t.body.files };
}

const patch = (path: string, data: unknown) =>
  json(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

describe('file upload', () => {
  it('knows no reports in a new workspace: the first upload is taught, the next is recognised', async () => {
    const ws = await newWorkspace();
    const first = await teach(ws, qualityName(ws), QUALITY, { name: 'Quality Overview' });
    expect(first.files).toMatchObject([{ id: first.upload.id, stage: 'imported', rowCount: 1 }]);

    const r = await upload(ws, qualityName(ws, '2026-07-02'), QUALITY.replace('2026-07-01', '2026-07-02'));
    expect(r).toMatchObject({ stage: 'imported', template: { id: first.template.id, name: 'Quality Overview' } });
    const f = (await json(`/workspaces/${ws.id}/files/${r.id}`)).body;
    expect(f).toMatchObject({ fileName: qualityName(ws, '2026-07-02'), format: 'csv', templateId: first.template.id, stage: 'imported' });
    expect(f.storageKey).toBeUndefined(); // never exposed
    expect(f.definitionKey).toBeUndefined(); // no built-in report types any more
    expect((await app.request('/definitions')).status).toBe(404);
  });

  it('saves each line as JSON with its driver, day and week', async () => {
    const ws = await newWorkspace();
    await teach(ws, qualityName(ws), QUALITY);
    const content = `${QUALITY.replaceAll('2026-07-01', '2026-07-02')}\n"2026-07-02","Bob Driver","a2bbbbbbbbbbbb","abc","1","","NA","0"`;
    const r = await upload(ws, qualityName(ws, '2026-07-02'), content);
    expect(r).toMatchObject({ stage: 'imported', rowCount: 2, issueCount: 1 });

    const { total, rows } = (await json(`/workspaces/${ws.id}/files/${r.id}/rows`)).body;
    expect(total).toBe(2);
    expect(rows[0]).toMatchObject({
      line: 2, driverKey: 'A1AAAAAAAAAAAA', driverName: 'Ann Driver', day: '2026-07-02', year: 2026, week: 27, issues: [],
      data: { 'Date': '2026-07-02', 'Transporter ID': 'A1AAAAAAAAAAAA', 'Packages Delivered': 200, 'POD': 99.5, 'DSB Count': 0 },
    });
    expect(rows[1].driverKey).toBe('A2BBBBBBBBBBBB'); // IDs are upper-cased
    expect(rows[1].data).toMatchObject({ 'Packages Delivered': null, 'POD': null });
    expect(rows[1].issues).toEqual([{ column: 'Packages Delivered', value: 'abc', problem: 'not a valid int' }]);
    expect((await json(`/workspaces/${ws.id}/files/${r.id}/rows?with_issues=true`)).body.total).toBe(1);

    // the local copy is gone once the rows are saved, so it cannot be re-imported
    const dir = path.join(config.STORAGE_DIR, ws.id, 'raw');
    expect(existsSync(dir) ? await readdir(dir) : []).toEqual([]);
    expect((await post(`/workspaces/${ws.id}/files/${r.id}/reimport`, {})).status).toBe(409);
  });

  it('imports a file from its URL and keeps no copy', async () => {
    const ws = await newWorkspace();
    await teach(ws, qualityName(ws, '2026-06-30'), QUALITY.replace('2026-07-01', '2026-06-30'));
    const url = host(`/bucket/${qualityName(ws)}?X-Amz-Signature=abc`, QUALITY);
    const r = await post(`/workspaces/${ws.id}/files`, { files: [{ url }] });
    expect(r.status).toBe(201);
    expect(r.body[0]).toMatchObject({ fileName: qualityName(ws), url, stage: 'imported', rowCount: 1 });
    expect((await json(`/workspaces/${ws.id}/files/${r.body[0].id}`)).body.fileUrl).toBe(url);

    const again = await post(`/workspaces/${ws.id}/files/${r.body[0].id}/reimport`, {}); // read from the URL again
    expect(again.body).toMatchObject({ stage: 'imported', rowCount: 1 }); // replaces, never doubles
    expect((await json(`/workspaces/${ws.id}/files/${r.body[0].id}/rows`)).body.total).toBe(1);

    const missing = await post(`/workspaces/${ws.id}/files`, { files: [{ url: `${hostUrl}/nope.csv` }] });
    expect(missing.body[0]).toMatchObject({ stage: 'rejected', error: 'Could not download the file: download failed: HTTP 404' });
  });

  it('returns the draft for an unknown report sent by URL; confirming needs only the file id', async () => {
    const ws = await newWorkspace();
    const url = host('/bucket/Fuel_Log_2026-07-01.csv', 'Driver Name,Employee ID,Fill Date,Gallons\nAnn,E1001,2026-07-01,12.5\n');
    const [r] = (await post(`/workspaces/${ws.id}/files`, { files: [{ url }] })).body;
    expect(r.stage).toBe('needs_template');
    expect(r.draft).toMatchObject({ name: 'Fuel Log', headerRow: 0, periodKind: 'day', reader: null });
    expect(r.draft.columns.map((col: any) => [col.header, col.type, col.role])).toEqual([
      ['Driver Name', 'text', 'driver_name'], ['Employee ID', 'id', 'driver_id'], ['Fill Date', 'date', 'date'], ['Gallons', 'decimal', null]]);

    const taught = await post(`/workspaces/${ws.id}/templates`, { file_id: r.id }); // the user accepts the draft as it is
    expect(taught.body.template.name).toBe('Fuel Log');
    expect(taught.body.files).toMatchObject([{ id: r.id, stage: 'imported', rowCount: 1 }]);
  });

  it('uses the report date for rows of a daily export without a date column', async () => {
    const ws = await newWorkspace();
    // the user says the Week column is not this export's period: it covers one day, chosen at upload
    const { template } = await teach(ws, 'DSP_Associates_Concessions_DXX1_ - 2026-06-29T100442.178.csv', ASSOC_BROKEN,
      { columns: [{ key: 'week', role: null }] });
    expect(template).toMatchObject({ periodSource: 'ask', periodKind: 'day' });

    const r = await upload(ws, 'DSP_Associates_Concessions_DXX1_ - 2026-07-02T100442.178.csv', ASSOC_BROKEN.replace('"200"', '"201"'));
    expect(r).toMatchObject({ referenceDate: '2026-07-01', stage: 'imported' }); // the export time's day before
    const [row] = (await json(`/workspaces/${ws.id}/files/${r.id}/rows`)).body.rows;
    expect(row).toMatchObject({ driverKey: 'A1AAAAAAAAAAAA', day: '2026-07-01', year: 2026, week: 27 });
    expect(row.data).toMatchObject({ 'Week': '2026-W27', 'undefined': 1, 'undefined %': 0.5, 'undefined (2)': 4975 });

    const noDate = await upload(ws, 'DSP_Associates_Concessions_DXX1_.csv', ASSOC_BROKEN.replace('"200"', '"202"'));
    expect(noDate.stage).toBe('needs_reference_date');
    expect((await post(`/workspaces/${ws.id}/files/${noDate.id}/confirm`, {})).status).toBe(422);
    const c = await post(`/workspaces/${ws.id}/files/${noDate.id}/confirm`, { reference_date: '2026-07-03' });
    expect(c.body).toMatchObject({ stage: 'imported', referenceDate: '2026-07-03' });
  });

  it('asks a weekly report for its week, not a day', async () => {
    const ws = await newWorkspace();
    const content = (n: number) => `Driver Name,Employee ID,Score\nAnn,E1001,${n}\n`;
    const { template, files } = await teach(ws, 'weekly_score.csv', content(90), { name: 'Weekly score', period_kind: 'week' });
    expect(template).toMatchObject({ periodSource: 'ask', periodKind: 'week' });
    expect(files[0].stage).toBe('needs_reference_date');
    const refused = await post(`/workspaces/${ws.id}/files/${files[0].id}/confirm`, {});
    expect(refused.body.detail).toContain('report week');
    const c = await post(`/workspaces/${ws.id}/files/${files[0].id}/confirm`, { reference_week: '2026-W27' });
    expect(c.body).toMatchObject({ stage: 'imported', referenceWeek: '2026-W27' });
    const [row] = (await json(`/workspaces/${ws.id}/files/${files[0].id}/rows`)).body.rows;
    expect(row).toMatchObject({ day: null, year: 2026, week: 27 });

    const next = await upload(ws, 'weekly_score.csv', content(85), { reference_week: '2026-W28' });
    expect(next).toMatchObject({ stage: 'imported', referenceWeek: '2026-W28' });
    const named = await upload(ws, 'weekly_score_2026-W29.csv', content(80)); // the week in the name is enough
    expect(named).toMatchObject({ stage: 'imported', referenceWeek: '2026-W29' });
  });

  it('shows each daily and weekly report by period: the latest by default, the latest upload per period', async () => {
    const ws = await newWorkspace();
    const day = (d: string, pkgs: number) => QUALITY.replace('2026-07-01', d).replace('"200"', `"${pkgs}"`);
    const { template: daily } = await teach(ws, qualityName(ws), QUALITY, {
      name: 'Quality', metrics: [{ name: 'Packages', op: 'sum', column: 'packages_delivered', by: 'file' }],
    });
    await upload(ws, qualityName(ws, '2026-07-02'), day('2026-07-02', 120));
    const redo = await upload(ws, qualityName(ws), day('2026-07-01', 210)); // a re-export of 1 July replaces the first
    if (redo.stage === 'needs_confirmation') await post(`/workspaces/${ws.id}/files/${redo.id}/confirm`, { accept_warnings: true });

    const latest = (await json(`/workspaces/${ws.id}/reports/daily`)).body;
    expect(latest).toMatchObject({ kind: 'day', templateId: daily.id, period: '2026-07-02' });
    expect(latest.reports).toMatchObject([{ id: daily.id, periods: ['2026-07-02', '2026-07-01'] }]);
    expect(latest.report.metrics).toMatchObject([{ metricKey: 'packages', value: 120 }]);

    const first = (await json(`/workspaces/${ws.id}/reports/daily?period=2026-07-01`)).body.report;
    expect(first.rows).toHaveLength(1);
    expect(first.files).toMatchObject([{ id: redo.id }]);
    expect(first.replaced).toHaveLength(1);
    expect(first.metrics[0].value).toBe(210);

    const none = (await json(`/workspaces/${ws.id}/reports/daily?period=2026-06-01`)).body.report;
    expect(none).toMatchObject({ rows: [], files: [] });
    expect((await json(`/workspaces/${ws.id}/reports/daily?period=July`)).status).toBe(400);

    const content = (n: number) => `Driver Name,Employee ID,Score\nAnn,E1001,${n}\n`;
    const { template: weekly, files } = await teach(ws, 'weekly_score_2026-W27.csv', content(90), { name: 'Weekly score', period_kind: 'week' });
    expect(files[0].stage).toBe('imported');
    await upload(ws, 'weekly_score_2026-W28.csv', content(85));
    const week = (await json(`/workspaces/${ws.id}/reports/weekly`)).body;
    expect(week).toMatchObject({ kind: 'week', templateId: weekly.id, period: '2026-W28' });
    expect(week.reports).toMatchObject([{ name: 'Weekly score', periods: ['2026-W28', '2026-W27'] }]);
    const w27 = (await json(`/workspaces/${ws.id}/reports/weekly?template=${weekly.id}&period=2026-W27`)).body.report;
    expect(w27.rows).toMatchObject([{ driverName: 'Ann', data: { Score: 90 } }]);
  });

  it('finds the header when rows above it come and go (Netradyne preambles)', async () => {
    const ws = await newWorkspace();
    const body = 'Driver Name,Driver ID,Minutes Analyzed,Driver Score,Hard Braking,Total Events\nAnn,QX1,120,90,1,4\n';
    await teach(ws, 'drivers_report_2026-07-01.csv', `Fleet Name,${ws.code}\nDuration,1 day\n\n${body}`);
    const r = await upload(ws, 'drivers_report_2026-07-02.csv', `Fleet Name,${ws.code}\nDuration,1 day\nRisk,Severe\n\n${body}`);
    expect(r.stage).toBe('imported');
    expect((await json(`/workspaces/${ws.id}/files/${r.id}`)).body.headerRow).toBe(4);
  });

  it('keeps only the columns the template keeps, and computes its analytics', async () => {
    const ws = await newWorkspace();
    const fuel = 'Driver Name,Employee ID,Fill Date,Gallons,Card Number\nAnn,E1001,2026-07-01,12.5,4111\nAnn,E1001,2026-07-01,7.5,4111\nBob,E1002,2026-07-01,9,4222\n';
    const { template, files } = await teach(ws, 'fuel_2026-07-01.csv', fuel, {
      name: 'Fuel', columns: [{ key: 'card number', include: false }],
      metrics: [{ name: 'Gallons per driver', op: 'sum', column: 'gallons', by: 'driver' }],
    });
    expect(template.metrics).toEqual([{ key: 'gallons_per_driver', name: 'Gallons per driver', op: 'sum', column: 'gallons', by: 'driver', where: null }]);
    const [row] = (await json(`/workspaces/${ws.id}/files/${files[0].id}/rows`)).body.rows;
    expect(row.data).not.toHaveProperty('Card Number');

    const m = (await json(`/workspaces/${ws.id}/files/${files[0].id}/metrics`)).body;
    expect(m.map((x: any) => [x.groupKey, x.groupLabel, x.value])).toEqual([['E1001', 'Ann', 20], ['E1002', 'Bob', 9]]);

    // analytics can change later: recomputed from the saved rows, the original isn't needed
    const changed = await patch(`/workspaces/${ws.id}/templates/${template.id}`, {
      metrics: [{ name: 'Fills', op: 'count', by: 'file' }, { name: 'Average gallons', op: 'avg', column: 'gallons' }],
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ template: { version: 2 }, metricValues: 2 });
    const all = (await json(`/workspaces/${ws.id}/templates/${template.id}/metrics`)).body;
    expect(all.map((x: any) => [x.metricKey, x.value])).toEqual([['average_gallons', 29 / 3], ['fills', 3]]);

    const bad = await patch(`/workspaces/${ws.id}/templates/${template.id}`, { metrics: [{ name: 'Total', op: 'sum', column: 'litres' }] });
    expect(bad.status).toBe(422);
  });

  it('recognises a file held before its report was taught, once it is confirmed', async () => {
    const ws = await newWorkspace();
    const first = await upload(ws, qualityName(ws), QUALITY);
    const dup = await upload(ws, qualityName(ws), QUALITY); // held as a duplicate; no template exists yet
    expect([first.stage, dup.stage]).toEqual(['needs_template', 'needs_confirmation']);
    await post(`/workspaces/${ws.id}/templates`, { file_id: first.id, name: 'Quality' });
    const ok = await post(`/workspaces/${ws.id}/files/${dup.id}/confirm`, { accept_warnings: true });
    expect(ok.body).toMatchObject({ stage: 'imported', rowCount: 1 });
  });

  it('holds duplicates and foreign-DSP files until confirmed', async () => {
    const ws = await newWorkspace();
    await teach(ws, qualityName(ws), QUALITY);
    const dup = await upload(ws, qualityName(ws), QUALITY);
    expect(dup.stage).toBe('needs_confirmation');
    expect(dup.warnings[0].code).toBe('duplicate');

    const foreign = '"Delivery Associate Name","Delivery Associate","Impacts DSB","Delivery Type","Tracking ID",'
      + '"Concession Date","Service Area","DSP"\n"X","A9","0","Unattended","TBA1","2026-06-30","ZZZ9","OTHR"\n';
    const r = await upload(ws, 'DSP_Delivery_Concessions_ZZZ9_.csv', foreign);
    expect(r.stage).toBe('needs_confirmation');
    expect(r.warnings[0].code).toBe('foreign_dsp');
    expect((await post(`/workspaces/${ws.id}/files/${r.id}/confirm`, {})).status).toBe(409); // must be confirmed knowingly
    const ok = await post(`/workspaces/${ws.id}/files/${r.id}/confirm`, { accept_warnings: true });
    expect(ok.body.stage).toBe('needs_template'); // then it is taught like any unknown report
    expect((await post(`/workspaces/${ws.id}/files/${r.id}/confirm`, { accept_warnings: true })).status).toBe(409);
  });

  it('asks once about an unknown report, then recognises it', async () => {
    const ws = await newWorkspace();
    const fuel = (day: string) => `Driver Name,Employee ID,Fill Date,Gallons\nAnn Driver,E1001,${day},12.5\n`;
    const first = await upload(ws, `Fuel_Log_${ws.code}_2026-07-01.csv`, fuel('2026-07-01'));
    const waiting = await upload(ws, `Fuel_Log_${ws.code}_2026-07-02.csv`, fuel('2026-07-02'));
    expect([first.stage, waiting.stage]).toEqual(['needs_template', 'needs_template']);

    const draft = (await json(`/workspaces/${ws.id}/files/${first.id}/template-draft`)).body;
    expect(draft).toMatchObject({ name: 'Fuel Log', headerRow: 0, periodSource: 'column', fileNamePattern: 'fuel_log_{dsp}_{date}' });
    expect(draft.columns.find((c: any) => c.key === 'employee id').role).toBe('driver_id');

    const taught = await post(`/workspaces/${ws.id}/templates`, { file_id: first.id, name: 'Fuel Log',
      columns: [{ key: 'gallons', type: 'decimal' }] });
    expect(taught.status).toBe(201);
    expect(taught.body.files).toMatchObject([{ id: first.id, stage: 'imported', rowCount: 1 }, { id: waiting.id, stage: 'imported' }]); // both move on

    const next = await upload(ws, `Fuel_Log_${ws.code}_2026-07-03 (1).csv`, fuel('2026-07-03'));
    expect(next).toMatchObject({ stage: 'imported', template: { id: taught.body.template.id, name: 'Fuel Log' } });
    expect(next.context.fileName).toMatchObject({ date: '2026-07-03', dsp: ws.code });
    expect((await post(`/workspaces/${ws.id}/templates`, { file_id: next.id, name: 'Fuel Log' })).status).toBe(409);
  });

  it('asks before updating a template whose columns changed', async () => {
    const ws = await newWorkspace();
    const r = await upload(ws, 'fuel_log.csv', 'Driver Name,Employee ID,Fill Date,Gallons\nAnn,E1001,2026-07-01,12.5\n');
    const t = (await post(`/workspaces/${ws.id}/templates`, { file_id: r.id, name: 'Fuel' })).body.template;

    const changed = await upload(ws, 'fuel_log.csv', 'Driver Name,Employee ID,Fill Date,Gallons,Cost\nAnn,E1001,2026-07-02,12.5,40\n');
    expect(changed.stage).toBe('needs_confirmation');
    expect(changed.warnings[0]).toMatchObject({ code: 'template_changed' });
    expect(changed.warnings[0].message).toContain('new: cost');
    expect((await post(`/workspaces/${ws.id}/files/${changed.id}/confirm`, { accept_warnings: true })).body.stage).toBe('imported');

    const after = (await json(`/workspaces/${ws.id}/templates/${t.id}`)).body;
    expect(after.version).toBe(2);
    expect(after.headers).toContain('cost');
    expect(after.columns.find((c: any) => c.key === 'employee id').role).toBe('driver_id'); // kept
    const again = await upload(ws, 'fuel_log.csv', 'Driver Name,Employee ID,Fill Date,Gallons,Cost\nBob,E1002,2026-07-03,9,30\n');
    expect(again.stage).toBe('imported');
  });

  it('asks for the report date when a taught report has none', async () => {
    const ws = await newWorkspace();
    const r = await upload(ws, 'yard_check.csv', 'Driver Name,Notes\nAnn,ok\n');
    const taught = (await post(`/workspaces/${ws.id}/templates`, { file_id: r.id, name: 'Yard Check' })).body;
    expect(taught.template.periodSource).toBe('ask');
    expect(taught.files[0].stage).toBe('needs_reference_date');
    expect((await upload(ws, 'yard_check.csv', 'Driver Name,Notes\nBob,ok\n', { reference_date: '2026-07-01' })).stage).toBe('imported');
  });

  it('rejects an unreadable file without storing it', async () => {
    const ws = await newWorkspace();
    const r = await upload(ws, 'broken.xlsx', 'PK\u0003\u0004 truncated zip'); // xlsx signature, broken body
    expect(r.stage).toBe('rejected');
    expect(r.id).toBeUndefined();
    expect((await json(`/workspaces/${ws.id}/files`)).body).toEqual([]);
  });

  it('keeps workspaces isolated', async () => {
    const ws = await newWorkspace();
    const { template } = await teach(ws, qualityName(ws), QUALITY);
    const other = await newWorkspace('O');
    const r = await upload(other, qualityName(other), QUALITY); // another workspace doesn't know this report
    expect(r.stage).toBe('needs_template');
    expect((await json(`/workspaces/${other.id}/templates/${template.id}`)).status).toBe(404);
    expect((await post(`/workspaces/${ws.id}/files/${r.id}/confirm`, { accept_warnings: true })).status).toBe(404);
  });
});
