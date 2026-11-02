/** How a report template finds the period each upload covers. */
export const PERIOD_SOURCES: Record<string, string> = {
  column: 'A date or week column',
  filename: 'The file name (else the uploader picks it)',
  ask: 'The uploader picks it at every upload',
};

/** PDF readers by their code name (packages/ingestion/src/pdf-readers.ts). */
export const READER_LABELS: Record<string, string> = {
  amazon_dsp_scorecard: 'Amazon DSP Scorecard',
  amazon_pod_details: 'Amazon POD Details',
};
