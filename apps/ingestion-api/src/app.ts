import { pool } from '@platform/db';
import { Hono } from 'hono';
import { ServiceError } from '@platform/ingestion-service';
import { HTTPException } from 'hono/http-exception';
import { type Env, serviceErrorResponse, withWorkspace } from './http.ts';
import { files } from './routes/files.ts';
import { periods } from './routes/periods.ts';
import { templates } from './routes/templates.ts';
import { workspaces } from './routes/workspaces.ts';

export const app = new Hono<Env>();

app.use('/workspaces/:workspaceId/files/*', withWorkspace);
app.use('/workspaces/:workspaceId/files', withWorkspace);
app.use('/workspaces/:workspaceId/templates/*', withWorkspace);
app.use('/workspaces/:workspaceId/templates', withWorkspace);
app.use('/workspaces/:workspaceId/reports/*', withWorkspace);

app.route('/workspaces', workspaces);
app.route('/workspaces/:workspaceId/files', files);
app.route('/workspaces/:workspaceId/templates', templates);
app.route('/workspaces/:workspaceId/reports', periods);

app.get('/health', async (c) => {
  await pool.query('select 1');
  return c.json({ status: 'ok' });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ServiceError) return serviceErrorResponse(err);
  console.error(err);
  return c.json({ detail: 'Internal error' }, 500);
});
