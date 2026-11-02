import { Link, createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, FileText, Inbox } from 'lucide-react';
import { z } from 'zod';
import { StageBadge } from '@/components/stage-badge';
import { UploadPanel } from '@/components/upload-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LocalTime } from '@/components/local-time';
import { formatDay, formatNumber } from '@/lib/format';
import { HELD, stageOf } from '@/lib/stages';
import { weekLabel } from '@/components/week-picker';
import { listReportTemplates, listUploads } from '@/server/reports.functions';

const FILTERS = { all: 'All', held: 'Needs attention', imported: 'Imported', failed: 'Failed' } as const;
type Filter = keyof typeof FILTERS;

export const Route = createFileRoute('/$workspaceId/reports/')({
  validateSearch: z.object({ show: z.enum(['all', 'held', 'imported', 'failed']).catch('all').default('all') }),
  loader: async ({ params }) => {
    const [files, templates] = await Promise.all([
      listUploads({ data: params }),
      listReportTemplates({ data: params }),
    ]);
    return { files, templates: Object.fromEntries(templates.map((t) => [t.id, { name: t.name, periodKind: t.periodKind }])) };
  },
  component: UploadsPage,
});

const matches = (stage: string, f: Filter) =>
  f === 'all' || (f === 'held' && HELD.has(stage)) || (f === 'imported' && (stage === 'imported' || stage === 'stored_file_only'))
  || (f === 'failed' && stage === 'failed');

function UploadsPage() {
  const { workspaceId } = Route.useParams();
  const { show } = Route.useSearch();
  const { files, templates } = Route.useLoaderData();
  const held = files.filter((f) => HELD.has(f.stage));
  const shown = files.filter((f) => matches(f.stage, show));
  const reportName = (f: (typeof files)[number]) => (f.templateId ? templates[f.templateId]?.name : null) ?? 'Not set up yet';

  return (
    <div className="space-y-8">
      <UploadPanel workspaceId={workspaceId} />

      {held.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />Needs your attention</CardTitle>
            <CardDescription>These uploads are waiting for an answer before their rows are imported.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {held.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{f.fileName}</div>
                    <div className="truncate text-sm text-muted-foreground">{f.warnings[0]?.message ?? stageOf(f.stage).hint}</div>
                  </div>
                  <StageBadge stage={f.stage} />
                  <Button asChild size="sm">
                    {f.stage === 'needs_template'
                      ? <Link to="/$workspaceId/reports/templates/new/$fileId" params={{ workspaceId, fileId: f.id }}>Teach template</Link>
                      : <Link to="/$workspaceId/reports/files/$fileId" params={{ workspaceId, fileId: f.id }}>Review</Link>}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Upload history</CardTitle>
            <CardDescription>The latest 200 uploads in this workspace.</CardDescription>
          </div>
          <Tabs value={show}>
            <TabsList>
              {(Object.keys(FILTERS) as Filter[]).map((k) => (
                <TabsTrigger key={k} value={k} asChild>
                  <Link to="." search={{ show: k }}>
                    {FILTERS[k]}
                    <span className="ml-1 text-xs text-muted-foreground">{files.filter((f) => matches(f.stage, k)).length}</span>
                  </Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
                <EmptyTitle>{files.length ? 'Nothing here' : 'No uploads yet'}</EmptyTitle>
                <EmptyDescription>{files.length ? 'No uploads match this filter.' : 'Upload a report above to get started.'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">File</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="pr-6">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-72 pl-6">
                      <Link to="/$workspaceId/reports/files/$fileId" params={{ workspaceId, fileId: f.id }} className="block truncate font-medium hover:underline">
                        {f.fileName}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{reportName(f)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {f.templateId && templates[f.templateId]?.periodKind === 'week'
                        ? (f.referenceWeek ? weekLabel(f.referenceWeek) : '—')
                        : formatDay(f.referenceDate)}
                    </TableCell>
                    <TableCell><StageBadge stage={f.stage} /></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.rowCount != null ? formatNumber(f.rowCount) : '—'}
                      {!!f.issueCount && <span className="ml-1 text-xs text-amber-700">({f.issueCount} issues)</span>}
                    </TableCell>
                    <TableCell className="pr-6 text-muted-foreground"><LocalTime value={f.createdAt} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
