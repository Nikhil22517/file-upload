/** HTTP routes for report templates: taught from an upload, then edited by the workspace's users. */
import {
  TemplateInput, TemplateUpdate, getTemplate, listTemplates, teachTemplate, templateMetrics, updateTemplate,
} from '@platform/ingestion-service';
import { Hono } from 'hono';
import { type Env, body } from '../http.ts';

export const templates = new Hono<Env>();

templates.post('/', async (c) => c.json(await teachTemplate(c.get('ws'), await body(c.req, TemplateInput)), 201));

templates.get('/', async (c) => c.json(await listTemplates(c.get('ws'))));

templates.get('/:templateId', async (c) => c.json(await getTemplate(c.get('ws'), c.req.param('templateId'))));

/** Change name, columns (type, role, keep/skip), PDF sections, period kind or analytics. */
templates.patch('/:templateId', async (c) =>
  c.json(await updateTemplate(c.get('ws'), c.req.param('templateId'), await body(c.req, TemplateUpdate))));

/** The template's analytics across its uploads (`?metric=` for one of them). */
templates.get('/:templateId/metrics', async (c) => c.json(await templateMetrics(c.get('ws'), c.req.param('templateId'), {
  metricKey: c.req.query('metric'), limit: Number(c.req.query('limit') ?? 500),
})));
