import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, BarChart3, CalendarDays, CircleAlert, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { StageBadge } from '@/components/stage-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LocalTime } from '@/components/local-time';
import { WeekPicker, weekLabel } from '@/components/week-picker';
import { formatBytes, formatDay, formatNumber, plural } from '@/lib/format';
import { stageOf } from '@/lib/stages';
import {
  confirmUpload, listReportTemplates, loadFile, loadFileMetrics, loadRows, reimportUpload,
} from '@/server/reports.functions';

const PAGE = 50;

export const Route = createFileRoute('/$workspaceId/reports/files/$fileId')({
  validateSearch: z.object({
    offset: z.number().int().min(0).catch(0).default(0),
    issues: z.boolean().catch(false).default(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const [file, templates] = await Promise.all([
      loadFile({ data: params }),
      listReportTemplates({ data: { workspaceId: params.workspaceId } }),
    ]);
    const imported = file.stage === 'imported';
    const [rows, metrics] = await Promise.all([
      imported ? loadRows({ data: { ...params, offset: deps.offset, withIssues: deps.issues } }) : null,
      imported ? loadFileMetrics({ data: params }) : [],
    ]);
    return { file, template: templates.find((t) => t.id === file.templateId) ?? null, rows, metrics };
  },
  component: FilePage,
});

type RowsPage = Awaited<ReturnType<typeof loadRows>>;

function FilePage() {
  const { workspaceId } = Route.useParams();
  const { file, template, rows, metrics } = Route.useLoaderData();
  const ctx = (file.context ?? {}) as { dsp?: string | null; station?: string | null };
  const period = template?.periodKind === 'week'
    ? (file.referenceWeek ? weekLabel(file.referenceWeek) : '—')
    : formatDay(file.referenceDate);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/$workspaceId/reports" params={{ workspaceId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />Uploads
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{file.fileName}</h1>
          <StageBadge stage={file.stage} />
        </div>
        <p className="text-sm text-muted-foreground">{stageOf(file.stage).hint}</p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-4 py-6 text-sm md:grid-cols-4">
          <Fact label="Report">
            {template
              ? <Link to="/$workspaceId/reports/templates/$templateId" params={{ workspaceId, templateId: template.id }} className="hover:underline">{template.name}</Link>
              : 'Not set up yet'}
            {template && <span className="ml-1 text-muted-foreground">v{template.version}</span>}
          </Fact>
          <Fact label={template?.periodKind === 'week' ? 'Report week' : 'Report date'}>{period}</Fact>
          <Fact label="DSP / station">{[ctx.dsp, ctx.station].filter(Boolean).join(' / ') || '—'}</Fact>
          <Fact label="Header row">{file.headerRow != null ? `Row ${file.headerRow + 1}` : '—'}</Fact>
          <Fact label="Rows">{file.rowCount != null ? formatNumber(file.rowCount) : '—'}</Fact>
          <Fact label="Rows with issues">{file.issueCount != null ? formatNumber(file.issueCount) : '—'}</Fact>
          <Fact label="Size">{formatBytes(file.byteSize)} · {file.format.toUpperCase()}</Fact>
          <Fact label="Uploaded"><LocalTime value={file.createdAt} /></Fact>
        </CardContent>
      </Card>

      <ActionPanel />
      {metrics.length > 0 && <AnalyticsCard metrics={metrics} />}
      {rows && <RowsCard rows={rows} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{children}</div>
    </div>
  );
}

/** What the person can do with the file at its current stage. */
function ActionPanel() {
  const { file } = Route.useLoaderData();
  const { workspaceId } = Route.useParams();
  switch (file.stage) {
    case 'needs_confirmation': return <ConfirmCard />;
    case 'needs_reference_date': return <PeriodCard />;
    case 'needs_template':
      return (
        <Alert>
          <Wand2 />
          <AlertTitle>We have not seen this report before</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Confirm its columns once; later uploads of the same report are recognised automatically.</span>
            <Button asChild size="sm">
              <Link to="/$workspaceId/reports/templates/new/$fileId" params={{ workspaceId, fileId: file.id }}>Teach template</Link>
            </Button>
          </AlertDescription>
        </Alert>
      );
    case 'failed':
      return (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>The import failed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{file.error ?? 'Unknown error'}</span>
            <ReimportButton />
          </AlertDescription>
        </Alert>
      );
    case 'imported': return <div className="flex justify-end"><ReimportButton variant="outline" /></div>;
    default: return null;
  }
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<{ stage: string; rowCount?: number | null }>, done: string) => {
    setBusy(true);
    try {
      const res = await fn();
      const outcome = res.stage === 'imported' ? `${done}: ${plural(res.rowCount ?? 0, 'row')} imported` : `${done}: now ${stageOf(res.stage).label.toLowerCase()}`;
      toast.success(outcome);
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

function ConfirmCard() {
  const { file } = Route.useLoaderData();
  const params = Route.useParams();
  const confirm = useServerFn(confirmUpload);
  const { busy, act } = useAction();
  const templateChanged = file.warnings.some((w) => w.code === 'template_changed');

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle>Check before importing</CardTitle>
        <CardDescription>Nothing is imported until you confirm. Cancel by simply leaving it here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {file.warnings.map((w) => (
          <Alert key={w.code} className="border-amber-200 bg-amber-50 text-amber-950">
            <CircleAlert />
            <AlertTitle>{WARNING_TITLES[w.code] ?? w.code}</AlertTitle>
            <AlertDescription className="text-amber-900">{w.message}</AlertDescription>
          </Alert>
        ))}
        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() => act(() => confirm({ data: { ...params, input: { accept_warnings: true } } }), 'Confirmed')}
          >
            {busy && <Loader2 className="animate-spin" />}
            {templateChanged ? 'Update template and import' : 'Import anyway'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const WARNING_TITLES: Record<string, string> = {
  duplicate: 'Already uploaded',
  foreign_dsp: 'Another DSP’s export',
  template_changed: 'The columns changed',
};

/** A file whose period isn't in its columns or name: the day (daily reports) or the week (weekly ones). */
function PeriodCard() {
  const { file, template } = Route.useLoaderData();
  const params = Route.useParams();
  const confirm = useServerFn(confirmUpload);
  const { busy, act } = useAction();
  const weekly = template?.periodKind === 'week';
  const [day, setDay] = useState(file.referenceDate ?? '');
  const [week, setWeek] = useState(file.referenceWeek ?? '');
  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-5" />{weekly ? 'Which week does this report cover?' : 'Which day does this export cover?'}
        </CardTitle>
        <CardDescription>
          The file has no {weekly ? 'week' : 'date'} in its columns or its name. Every row will be filed under this {weekly ? 'week' : 'day'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {weekly ? (
          <div className="grid gap-1.5">
            <Label htmlFor="ref-week">Report week</Label>
            <WeekPicker id="ref-week" value={week} onChange={setWeek} allowNone={false} />
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="ref-day">Report date</Label>
            <Input id="ref-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
          </div>
        )}
        <Button
          disabled={busy || (weekly ? !week : !day)}
          onClick={() => act(() => confirm({ data: { ...params, input: weekly ? { reference_week: week } : { reference_date: day } } }), weekly ? 'Week set' : 'Date set')}
        >
          {busy && <Loader2 className="animate-spin" />}Import with this {weekly ? 'week' : 'date'}
        </Button>
      </CardContent>
    </Card>
  );
}

type FileMetrics = Awaited<ReturnType<typeof loadFileMetrics>>;

/** This upload's analytics, as its template defines them. */
function AnalyticsCard({ metrics }: { metrics: FileMetrics }) {
  const { workspaceId } = Route.useParams();
  const { template } = Route.useLoaderData();
  const byMetric = new Map<string, FileMetrics>();
  for (const m of metrics) byMetric.set(m.metricKey, [...(byMetric.get(m.metricKey) ?? []), m]);
  const label = (m: FileMetrics[number]) => m.groupBy === 'driver' ? (m.groupLabel ?? m.groupKey)
    : m.groupBy === 'day' ? formatDay(m.day) : m.groupBy === 'week' ? weekLabel(m.groupKey) : 'Whole upload';
  const value = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2"><BarChart3 className="size-5" />Analytics</CardTitle>
          <CardDescription>Worked out from this upload’s rows, as the report’s template defines them.</CardDescription>
        </div>
        {template && (
          <Button asChild size="sm" variant="outline">
            <Link to="/$workspaceId/reports/templates/$templateId" params={{ workspaceId, templateId: template.id }}>Change analytics</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...byMetric.entries()].map(([key, values]) => (
          <div key={key} className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">{values[0].metricName}</div>
            {values.length === 1 && values[0].groupBy === 'file' ? (
              <div className="px-3 py-4 text-2xl font-semibold tabular-nums">{value(values[0].value)}</div>
            ) : (
              <ul className="max-h-56 divide-y overflow-auto text-sm">
                {values.map((m) => (
                  <li key={m.groupKey} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="truncate text-muted-foreground">{label(m)}</span>
                    <span className="tabular-nums">{value(m.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReimportButton({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const { file } = Route.useLoaderData();
  const params = Route.useParams();
  const reimport = useServerFn(reimportUpload);
  const { busy, act } = useAction();
  if (!file.hasOriginal) {
    return <span className="text-sm text-muted-foreground">The original was removed after import; upload it again to re-read it.</span>;
  }
  return (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => act(() => reimport({ data: params }), 'Re-imported')}>
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Re-import
    </Button>
  );
}

function RowsCard({ rows }: { rows: RowsPage }) {
  const { offset, issues } = Route.useSearch();
  const columns = [...new Set(rows.rows.flatMap((r) => Object.keys(r.data)))];
  const end = Math.min(offset + PAGE, rows.total);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Imported rows</CardTitle>
          <CardDescription>
            {rows.total ? `Rows ${offset + 1}–${end} of ${formatNumber(rows.total)}` : 'No rows'}
            {issues && ' with unreadable values'}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant={issues ? 'default' : 'outline'}>
            <Link to="." search={{ offset: 0, issues: !issues }}>{issues ? 'Show all rows' : 'Only rows with issues'}</Link>
          </Button>
          <Button asChild size="sm" variant="outline" disabled={offset === 0}>
            <Link to="." search={{ offset: Math.max(0, offset - PAGE), issues }} disabled={offset === 0}>Previous</Link>
          </Button>
          <Button asChild size="sm" variant="outline" disabled={end >= rows.total}>
            <Link to="." search={{ offset: offset + PAGE, issues }} disabled={end >= rows.total}>Next</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[32rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="pl-6">Line</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Day / week</TableHead>
                {columns.map((c) => <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.rows.map((r) => {
                const bad = new Map(r.issues.map((i) => [i.column, i]));
                return (
                  <TableRow key={r.line}>
                    <TableCell className="pl-6 tabular-nums text-muted-foreground">{r.line}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.driverName ?? r.driverKey ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.day ? formatDay(r.day) : r.week ? `${r.year}-W${String(r.week).padStart(2, '0')}` : '—'}
                    </TableCell>
                    {columns.map((c) => {
                      const issue = bad.get(c);
                      return (
                        <TableCell key={c} className={issue ? 'bg-red-50 text-red-800' : 'whitespace-nowrap'} title={issue ? `${issue.problem}: "${issue.value}"` : undefined}>
                          {issue ? issue.value : formatCell(r.data[c])}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

const formatCell = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
