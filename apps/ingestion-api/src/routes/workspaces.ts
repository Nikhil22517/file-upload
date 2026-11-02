import { WorkspaceInput, createWorkspace, listWorkspaces } from '@platform/ingestion-service';
import { Hono } from 'hono';
import { body } from '../http.ts';

export const workspaces = new Hono();

workspaces.post('/', async (c) => c.json(await createWorkspace(await body(c.req, WorkspaceInput)), 201));

workspaces.get('/', async (c) => c.json(await listWorkspaces()));
