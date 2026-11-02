/**
 * Server functions for report uploads. Each runs on the server only (the client gets an RPC stub) and calls
 * @platform/ingestion-service, the same code the ingestion API runs, so both behave identically.
 *
 * TODO: authentication and a workspace-membership check in every function. Server functions are public
 * endpoints, so the check belongs here, not only in the routes.
 */
import {
  ConfirmInput, ServiceError, TemplateInput, TemplateUpdate, WorkspaceInput, confirmFile, createWorkspace, fileMetrics,
  fileRows, fromFile, getFile, getTemplate, getWorkspace, listFiles, listTemplates, periodView, reimportFile, teachTemplate,
  templateDraft, templateMetrics, updateTemplate, uploadFiles, listWorkspaces as listAllWorkspaces,
} from '@platform/ingestion-service';
import { runMigrations } from '@platform/db';
import { PDF_READER_BY_NAME } from '@platform/ingestion';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

/** The schema is brought up to date once, on the first call (idempotent and lock-protected, like the API's startup),
 *  so the web app runs without the ingestion API having started first. */
let migrated: Promise<void> | undefined;

/** A service refusal reaches the browser as an Error whose message is the reason, ready to show.
 *  For page loads (`pageLoad`), a missing workspace or file shows the not-found page instead. */
async function run<T>(fn: () => Promise<T>, pageLoad = false): Promise<T> {
  try {
    await (migrated ??= runMigrations());
    return await fn();
  } catch (e) {
    if (e instanceof ServiceError) {
      if (pageLoad && e.status === 404) throw notFound();
      throw new Error(e.message);
    }
    throw e;
  }
}

const Ws = z.object({ workspaceId: z.string() });
const WsFile = Ws.extend({ fileId: z.string() });

// ---------------- workspaces ----------------
export const listWorkspaces = createServerFn({ method: 'GET' }).handler(() => run(() => listAllWorkspaces()));

export const loadWorkspace = createServerFn({ method: 'GET' })
  .validator(Ws)
  .handler(({ data }) => run(() => getWorkspace(data.workspaceId), true));

export const addWorkspace = createServerFn({ method: 'POST' })
  .validator(WorkspaceInput)
  .handler(({ data }) => run(() => createWorkspace(data)));

// ---------------- files ----------------
/** One file per call, so the page can show each file's progress and outcome as it lands. */
export const uploadFile = createServerFn({ method: 'POST' })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error('Expected form data');
    const file = data.get('file');
    if (!(file instanceof File)) throw new Error('No file in the upload');
    const text = (k: string) => String(data.get(k) ?? '') || null;
    return { workspaceId: text('workspaceId') ?? '', file, referenceDate: text('referenceDate'), referenceWeek: text('referenceWeek') };
  })
  .handler(({ data }) => run(async () => {
    const ws = await getWorkspace(data.workspaceId);
    const [result] = await uploadFiles(ws, [fromFile(data.file)], { referenceDate: data.referenceDate, referenceWeek: data.referenceWeek });
    return result;
  }));

export const listUploads = createServerFn({ method: 'GET' })
  .validator(Ws)
  .handler(({ data }) => run(async () => listFiles(await getWorkspace(data.workspaceId))));

export const loadFile = createServerFn({ method: 'GET' })
  .validator(WsFile)
  .handler(({ data }) => run(async () => getFile(await getWorkspace(data.workspaceId), data.fileId), true));

export const loadRows = createServerFn({ method: 'GET' })
  .validator(WsFile.extend({ offset: z.number().int().min(0).default(0), withIssues: z.boolean().default(false) }))
  .handler(({ data }) => run(async () => fileRows(await getWorkspace(data.workspaceId), data.fileId, {
    limit: 50, offset: data.offset, withIssues: data.withIssues,
  })));

export const confirmUpload = createServerFn({ method: 'POST' })
  .validator(WsFile.extend({ input: ConfirmInput }))
  .handler(({ data }) => run(async () => confirmFile(await getWorkspace(data.workspaceId), data.fileId, data.input)));

export const reimportUpload = createServerFn({ method: 'POST' })
  .validator(WsFile)
  .handler(({ data }) => run(async () => reimportFile(await getWorkspace(data.workspaceId), data.fileId)));

// ---------------- templates ----------------
export const loadTemplateDraft = createServerFn({ method: 'GET' })
  .validator(WsFile.extend({ headerRow: z.number().int().min(0).max(14).optional() }))
  .handler(({ data }) => run(async () => templateDraft(await getWorkspace(data.workspaceId), data.fileId, data.headerRow)));

export const saveTemplate = createServerFn({ method: 'POST' })
  .validator(Ws.extend({ input: TemplateInput }))
  .handler(({ data }) => run(async () => teachTemplate(await getWorkspace(data.workspaceId), data.input)));

export const listReportTemplates = createServerFn({ method: 'GET' })
  .validator(Ws)
  .handler(({ data }) => run(async () => listTemplates(await getWorkspace(data.workspaceId))));

const WsTemplate = Ws.extend({ templateId: z.string() });

/** A template with the sections its PDF reader can produce (to choose which to keep). */
export const loadTemplate = createServerFn({ method: 'GET' })
  .validator(WsTemplate)
  .handler(({ data }) => run(async () => {
    const t = await getTemplate(await getWorkspace(data.workspaceId), data.templateId);
    return { ...t, readerSections: t.reader ? PDF_READER_BY_NAME[t.reader]?.sections ?? [] : [] };
  }, true));

export const editTemplate = createServerFn({ method: 'POST' })
  .validator(WsTemplate.extend({ input: TemplateUpdate }))
  .handler(({ data }) => run(async () => updateTemplate(await getWorkspace(data.workspaceId), data.templateId, data.input)));

export const loadTemplateMetrics = createServerFn({ method: 'GET' })
  .validator(WsTemplate)
  .handler(({ data }) => run(async () => templateMetrics(await getWorkspace(data.workspaceId), data.templateId, { limit: 1000 })));

export const loadFileMetrics = createServerFn({ method: 'GET' })
  .validator(WsFile)
  .handler(({ data }) => run(async () => fileMetrics(await getWorkspace(data.workspaceId), data.fileId)));

// ---------------- reports by period ----------------
/** The Daily or Weekly screen: the reports of that kind, and the chosen one for the chosen day or week
 *  (default: the report with the newest data, at its latest period). */
export const loadPeriodView = createServerFn({ method: 'GET' })
  .validator(Ws.extend({ kind: z.enum(['day', 'week']), templateId: z.string().optional(), period: z.string().optional() }))
  .handler(({ data }) => run(async () => periodView(await getWorkspace(data.workspaceId), {
    kind: data.kind, template_id: data.templateId, period: data.period,
  }), true));
