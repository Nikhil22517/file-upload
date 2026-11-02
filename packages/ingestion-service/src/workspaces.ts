import { db, workspace } from '@platform/db';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail, isUniqueViolation, isUuid } from './errors.ts';

export type Workspace = typeof workspace.$inferSelect;

export const WorkspaceInput = z.object({
  code: z.string().trim().min(2).max(10).describe('DSP code, e.g. PTLG'),
  name: z.string().trim().min(1),
});

export async function createWorkspace(input: z.input<typeof WorkspaceInput>): Promise<Workspace> {
  const { code, name } = WorkspaceInput.parse(input);
  try {
    const [ws] = await db.insert(workspace).values({ code: code.toUpperCase(), name }).returning();
    return ws;
  } catch (e) {
    if (isUniqueViolation(e)) fail(409, `A workspace with code ${code.toUpperCase()} already exists`);
    throw e;
  }
}

export const listWorkspaces = (): Promise<Workspace[]> => db.select().from(workspace).orderBy(asc(workspace.code));

/** TODO: authentication, and a membership check that the caller belongs to this workspace. */
export async function getWorkspace(id: string): Promise<Workspace> {
  if (!isUuid(id)) fail(404, 'Workspace not found');
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, id));
  return ws ?? fail(404, 'Workspace not found');
}
