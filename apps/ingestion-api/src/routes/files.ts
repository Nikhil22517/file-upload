/** HTTP routes for report files. The work is done by @platform/ingestion-service (shared with the web app). */
import {
  ConfirmInput, UrlUploadInput, confirmFile, fileMetrics, fileRows, fromFile, fromUrls, getFile, listFiles, reimportFile,
  templateDraft, uploadFiles,
} from '@platform/ingestion-service';
import { Hono } from 'hono';
import { type Env, body } from '../http.ts';

export const files = new Hono<Env>();

/** Upload as multipart `files`, or as JSON `{ "files": [{ "url": "..." }] }` for files you stored yourself. */
files.post('/', async (c) => {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const b = await body(c.req, UrlUploadInput);
    return c.json(await uploadFiles(c.get('ws'), fromUrls(b.files), { referenceDate: b.reference_date, referenceWeek: b.reference_week }), 201);
  }
  const form = await c.req.parseBody({ all: true });
  const uploads = ([] as unknown[]).concat(form.files ?? []).filter((f): f is File => f instanceof File);
  const text = (k: string) => (typeof form[k] === 'string' && form[k] ? (form[k] as string) : null);
  return c.json(await uploadFiles(c.get('ws'), uploads.map(fromFile), {
    referenceDate: text('reference_date'), referenceWeek: text('reference_week'),
  }), 201);
});

files.post('/:fileId/confirm', async (c) =>
  c.json(await confirmFile(c.get('ws'), c.req.param('fileId'), await body(c.req, ConfirmInput))));

/** Import a file again, e.g. after it failed or after its template's columns were corrected. */
files.post('/:fileId/reimport', async (c) => c.json(await reimportFile(c.get('ws'), c.req.param('fileId'))));

files.get('/:fileId/rows', async (c) => c.json(await fileRows(c.get('ws'), c.req.param('fileId'), {
  limit: Number(c.req.query('limit') ?? 50),
  offset: Number(c.req.query('offset') ?? 0),
  withIssues: c.req.query('with_issues') === 'true',
})));

/** `?header_row=` redrafts from another row when the guess picked the wrong one. */
files.get('/:fileId/template-draft', async (c) => {
  const hr = c.req.query('header_row');
  return c.json(await templateDraft(c.get('ws'), c.req.param('fileId'), hr ? Number(hr) : undefined));
});

files.get('/', async (c) => c.json(await listFiles(c.get('ws'), {
  stage: c.req.query('stage'), limit: Number(c.req.query('limit') ?? 200),
})));

/** The upload's analytics, as its template defines them. */
files.get('/:fileId/metrics', async (c) => c.json(await fileMetrics(c.get('ws'), c.req.param('fileId'))));

files.get('/:fileId', async (c) => c.json(await getFile(c.get('ws'), c.req.param('fileId'))));
