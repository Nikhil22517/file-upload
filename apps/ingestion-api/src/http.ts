import { ServiceError, type Workspace, getWorkspace } from '@platform/ingestion-service';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export type { Workspace };
export type Env = { Variables: { ws: Workspace } };

export const fail = (status: 400 | 404 | 409 | 422, detail: unknown): never => {
  throw new HTTPException(status, { res: Response.json({ detail }, { status }) });
};

/** Every workspace-scoped route resolves the workspace first; unknown ids are a 404. */
export const withWorkspace = createMiddleware<Env>(async (c, next) => {
  c.set('ws', await getWorkspace(c.req.param('workspaceId') ?? ''));
  await next();
});

/** A request body checked against a schema; a bad body is a 422 with the zod issues. */
export async function body<T extends z.ZodTypeAny>(req: { json(): Promise<unknown> }, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) fail(422, parsed.error.issues);
  return parsed.data;
}

/** A service refusal becomes the same `{ detail }` response the routes always returned. */
export const serviceErrorResponse = (e: ServiceError) => Response.json({ detail: e.detail }, { status: e.status });
