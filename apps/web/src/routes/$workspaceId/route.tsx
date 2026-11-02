import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { listWorkspaces, loadWorkspace } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId')({
  loader: async ({ params }) => {
    const [workspace, workspaces] = await Promise.all([
      loadWorkspace({ data: { workspaceId: params.workspaceId } }),
      listWorkspaces(),
    ]);
    return { workspace, workspaces };
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.workspace.name ?? 'Workspace'} · LMDmax` }] }),
  component: WorkspaceLayout,
});

const NAV = [
  { to: '/$workspaceId/reports/daily', label: 'Daily', exact: false },
  { to: '/$workspaceId/reports/weekly', label: 'Weekly', exact: false },
  { to: '/$workspaceId/reports', label: 'Uploads', exact: true },
  { to: '/$workspaceId/reports/templates', label: 'Templates', exact: false },
] as const;

function WorkspaceLayout() {
  const { workspace, workspaces } = Route.useLoaderData();
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="font-semibold tracking-tight">LMDmax</Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {workspace.name}
                <span className="rounded bg-muted px-1 font-mono text-xs">{workspace.code}</span>
                <ChevronsUpDown className="size-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} asChild>
                  <Link to="/$workspaceId/reports" params={{ workspaceId: w.id }}>
                    <span className="flex-1">{w.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{w.code}</span>
                    {w.id === workspace.id && <Check className="size-4" />}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/"><Plus className="size-4" />New workspace</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                params={{ workspaceId: workspace.id }}
                activeOptions={{ exact: n.exact }}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
