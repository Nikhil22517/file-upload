import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addWorkspace, listWorkspaces } from '@/server/reports.functions';

export const Route = createFileRoute('/')({
  loader: () => listWorkspaces(),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const workspaces = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">LMDmax</h1>
        <p className="text-muted-foreground">Choose a client workspace to upload and review its reports.</p>
      </header>

      {workspaces.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Workspaces</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/$workspaceId/reports"
                    params={{ workspaceId: w.id }}
                    className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"
                  >
                    <Building2 className="size-4 text-muted-foreground" />
                    <span className="font-medium">{w.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{w.code}</span>
                    <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <NewWorkspace first={workspaces.length === 0} />
    </main>
  );
}

function NewWorkspace({ first }: { first: boolean }) {
  const navigate = useNavigate();
  const create = useServerFn(addWorkspace);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const ws = await create({ data: { code, name } });
      toast.success(`Workspace ${ws.name} created`);
      await navigate({ to: '/$workspaceId/reports', params: { workspaceId: ws.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{first ? 'Create your first workspace' : 'New workspace'}</CardTitle>
        <CardDescription>One workspace per client. The DSP code is checked against every upload, so another DSP’s export is caught.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ws-code">DSP code</Label>
            <Input id="ws-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PTLG" required minLength={2} maxLength={10} className="w-32 font-mono" />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Client name" required />
          </div>
          <Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Create</Button>
        </form>
      </CardContent>
    </Card>
  );
}
