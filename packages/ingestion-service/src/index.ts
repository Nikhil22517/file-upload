/** Server-side report ingestion: everything the API and the web app do with uploads, as plain functions.
 *  Refusals throw ServiceError(status, detail); each caller turns that into its own kind of response. */
export { config } from './config.ts';
export { ServiceError, fail, isUuid } from './errors.ts';
export {
  ConfirmInput, DATE, type Incoming, UrlUploadInput, type UploadPeriod, type UploadResult, WEEK, confirmFile, fileRows,
  fromFile, fromUrls, getFile, listFiles, reimportFile, templateDraft, uploadFiles,
} from './files.ts';
export { importAll, importFile, type ImportResult, recomputeMetrics } from './importer.ts';
export {
  TemplateInput, TemplateUpdate, fileMetrics, getTemplate, listTemplates, teachTemplate, templateMetrics, updateTemplate,
} from './templates.ts';
export { PeriodQuery, type PeriodReport, periodReport, periodView, reportPeriods } from './periods.ts';
export { WorkspaceInput, type Workspace, createWorkspace, getWorkspace, listWorkspaces } from './workspaces.ts';
