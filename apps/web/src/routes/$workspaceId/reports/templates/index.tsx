import { Link, createFileRoute } from '@tanstack/react-router';
import { ChevronRight, LayoutTemplate } from 'lucide-react';
import { LocalTime } from '@/components/local-time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { READER_LABELS } from '@/lib/templates';
import { listReportTemplates } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId/reports/templates/')({
  loader: ({ params }) => listReportTemplates({ data: params }),
  component: TemplatesPage,
});

const ROLE_LABELS: Record<string, string> = { driver_id: 'Driver ID', driver_name: 'Driver name', date: 'Date', week: 'Week' };

function TemplatesPage() {
  const templates = Route.useLoaderData();
  const { workspaceId } = Route.useParams();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report templates</CardTitle>
        <CardDescription>
          Every report this workspace imports, as its users set it up: what to keep, how to read it and what to compute.
          An upload whose columns match a template is imported automatically. Open one to change it.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {templates.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><LayoutTemplate /></EmptyMedia>
              <EmptyTitle>No templates yet</EmptyTitle>
              <EmptyDescription>
                This workspace hasn’t set up any reports. Upload one: you’ll confirm its columns once, and it appears here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Columns kept</TableHead>
                <TableHead>Each upload covers</TableHead>
                <TableHead className="text-right">Analytics</TableHead>
                <TableHead className="text-right">Uploads</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-8 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => {
                const kept = t.columns.filter((c) => c.include !== false);
                return (
                  <TableRow key={t.id} className="cursor-pointer">
                    <TableCell className="pl-6">
                      <Link to="/$workspaceId/reports/templates/$templateId" params={{ workspaceId, templateId: t.id }} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        v{t.version} · {t.format.toUpperCase()}{t.reader ? ` · ${READER_LABELS[t.reader] ?? t.reader}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-md flex-wrap gap-1">
                        <span className="mr-1 text-sm text-muted-foreground">{kept.length} of {t.columns.length}</span>
                        {kept.filter((c) => c.role).map((c) => (
                          <Badge key={`${c.key}-${c.role}`} variant="outline" title={c.header}>{ROLE_LABELS[c.role!]}: {c.header}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.periodKind === 'week' ? 'A week' : 'A day'}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.metrics.length || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(t.uploads)}</TableCell>
                    <TableCell className="text-muted-foreground"><LocalTime value={t.updatedAt} /></TableCell>
                    <TableCell className="pr-6">
                      <Link to="/$workspaceId/reports/templates/$templateId" params={{ workspaceId, templateId: t.id }} aria-label={`Open ${t.name}`}>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
