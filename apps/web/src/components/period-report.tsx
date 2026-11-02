/** The Daily and Weekly screens: one report for one day or Amazon week, latest by default, with its analytics and rows. */
import { Link } from '@tanstack/react-router';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LocalTime } from '@/components/local-time';
import { WeekPicker, weekLabel } from '@/components/week-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDay, formatNumber, plural } from '@/lib/format';
import type { loadPeriodView } from '@/server/reports.functions';

export type PeriodView = Awaited<ReturnType<typeof loadPeriodView>>;
type Report = NonNullable<PeriodView['report']>;
type Metric = Report['metrics'][number];
export interface PeriodSearch { template?: string; period?: string }

const PAGE = 50;
const formatCell = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const formatValue = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

export function PeriodReportPage({ view, workspaceId, go }: {
  view: PeriodView; workspaceId: string; go: (search: PeriodSearch) => void;
}) {
  const weekly = view.kind === 'week';
  const word = weekly ? 'weekly' : 'daily';
  const label = (p: string) => (weekly ? weekLabel(p) : formatDay(p));
  const current = view.reports.find((r) => r.id === view.templateId) ?? null;
  const periods = current?.periods ?? [];
  const older = view.period ? periods.find((p) => p < view.period!) : undefined;
  const newer = view.period ? [...periods].reverse().find((p) => p > view.period!) : undefined;
  const isLatest = Boolean(view.period && view.period === periods[0]);

  if (!view.reports.length) {
    return (
      <Card>
        <CardContent>
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
              <EmptyTitle>No {word} reports set up</EmptyTitle>
              <EmptyDescription>
                A report shows here once its template is set to cover {weekly ? 'one Amazon week' : 'one day'}.
                Upload a report and set it up, or change an existing template’s period.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center gap-2">
              <Button asChild><Link to="/$workspaceId/reports" params={{ workspaceId }}>Upload reports</Link></Button>
              <Button asChild variant="outline"><Link to="/$workspaceId/reports/templates" params={{ workspaceId }}>Templates</Link></Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="period-report">Report</Label>
            <Select value={view.templateId ?? ''} onValueChange={(id) => go({ template: id })}>
              <SelectTrigger id="period-report" className="w-64"><SelectValue placeholder="Choose a report" /></SelectTrigger>
              <SelectContent>
                {view.reports.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}{!r.periods.length && <span className="text-muted-foreground"> · no data yet</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="period-pick">{weekly ? 'Week' : 'Date'}</Label>
            <div className="flex items-center gap-1">
              <Button
                size="icon" variant="outline" aria-label={weekly ? 'Previous week with data' : 'Previous date with data'}
                disabled={!older} onClick={() => older && go({ template: view.templateId ?? undefined, period: older })}
              >
                <ChevronLeft />
              </Button>
              {weekly ? (
                <WeekPicker
                  id="period-pick" value={view.period ?? ''} allowNone={false}
                  onChange={(w) => go({ template: view.templateId ?? undefined, period: w })}
                />
              ) : (
                <Input
                  id="period-pick" type="date" className="w-44" value={view.period ?? ''}
                  onChange={(e) => e.target.value && go({ template: view.templateId ?? undefined, period: e.target.value })}
                />
              )}
              <Button
                size="icon" variant="outline" aria-label={weekly ? 'Next week with data' : 'Next date with data'}
                disabled={!newer} onClick={() => newer && go({ template: view.templateId ?? undefined, period: newer })}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <Button variant="outline" disabled={isLatest || !periods.length} onClick={() => go({ template: view.templateId ?? undefined })}>
            Latest
          </Button>
          {periods.length > 0 && (
            <div className="grid basis-full gap-1.5">
              <span className="text-xs text-muted-foreground">{weekly ? 'Weeks' : 'Dates'} with data ({periods.length})</span>
              <div className="flex flex-wrap gap-1.5">
                {periods.slice(0, 10).map((p) => (
                  <Button
                    key={p} size="sm" variant={p === view.period ? 'default' : 'outline'} className="h-7"
                    onClick={() => go({ template: view.templateId ?? undefined, period: p })}
                  >
                    {weekly ? `W${p.slice(-2)}` : formatDay(p)}
                  </Button>
                ))}
                {periods.length > 10 && <span className="self-center text-xs text-muted-foreground">+{periods.length - 10} older</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!current?.periods.length ? (
        <Card>
          <CardContent>
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                <EmptyTitle>No data for “{current?.name}” yet</EmptyTitle>
                <EmptyDescription>Upload this report; once it’s imported, its latest {weekly ? 'week' : 'day'} shows here.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild><Link to="/$workspaceId/reports" params={{ workspaceId }}>Upload reports</Link></Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : !view.report || !view.report.rows.length ? (
        <Card>
          <CardContent>
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
                <EmptyTitle>No “{current.name}” for {view.period ? label(view.period) : 'this period'}</EmptyTitle>
                <EmptyDescription>
                  Nothing imported covers this {weekly ? 'week' : 'date'}. The latest is {label(periods[0])}.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => go({ template: view.templateId ?? undefined })}>Show the latest</Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <ReportBody report={view.report} workspaceId={workspaceId} title={label(view.report.period)} isLatest={isLatest} />
      )}
    </div>
  );
}

function ReportBody({ report, workspaceId, title, isLatest }: { report: Report; workspaceId: string; title: string; isLatest: boolean }) {
  return (
    <>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{report.template.name}</h2>
          <span className="text-muted-foreground">·</span>
          <span className="text-xl">{title}</span>
          {isLatest && <Badge variant="secondary">Latest</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {plural(report.rows.length, 'row')}{report.truncated && ' (first 5,000)'} from{' '}
          {report.files.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ', '}
              <Link to="/$workspaceId/reports/files/$fileId" params={{ workspaceId, fileId: f.id }} className="underline-offset-2 hover:underline">
                {f.fileName}
              </Link>
              {f.station && ` (${f.station})`} · uploaded <LocalTime value={f.createdAt} />
            </span>
          ))}
          {report.replaced.length > 0 && `. ${plural(report.replaced.length, 'older upload')} of this period replaced by the latest.`}
        </p>
      </div>
      <MetricsCard report={report} workspaceId={workspaceId} />
      <RowsCard report={report} />
    </>
  );
}

function MetricsCard({ report, workspaceId }: { report: Report; workspaceId: string }) {
  const byMetric = new Map<string, Metric[]>();
  for (const m of report.metrics) byMetric.set(m.metricKey, [...(byMetric.get(m.metricKey) ?? []), m]);
  const label = (m: Metric) => (m.by === 'driver' ? (m.groupLabel ?? m.groupKey)
    : m.by === 'day' ? formatDay(m.day) : m.by === 'week' ? weekLabel(m.groupKey) : 'Total');
  const change = (
    <Button asChild size="sm" variant="outline">
      <Link to="/$workspaceId/reports/templates/$templateId" params={{ workspaceId, templateId: report.template.id }}>
        {byMetric.size ? 'Change analytics' : 'Add analytics'}
      </Link>
    </Button>
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2"><BarChart3 className="size-5" />Analytics</CardTitle>
          <CardDescription>
            {byMetric.size ? 'Worked out from the rows below, as the report’s template defines them.' : 'This report has no analytics yet.'}
          </CardDescription>
        </div>
        {change}
      </CardHeader>
      {byMetric.size > 0 && (
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...byMetric.entries()].map(([key, values]) => (
            <div key={key} className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">{values[0].metricName}</div>
              {values.length === 1 && values[0].by === 'file' ? (
                <div className="px-3 py-4 text-2xl font-semibold tabular-nums">{formatValue(values[0].value)}</div>
              ) : (
                <ul className="max-h-56 divide-y overflow-auto text-sm">
                  {[...values].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)).map((m) => (
                    <li key={m.groupKey} className="flex justify-between gap-3 px-3 py-1.5">
                      <span className="truncate text-muted-foreground">{label(m)}</span>
                      <span className="tabular-nums">{formatValue(m.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function RowsCard({ report }: { report: Report }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const weekly = report.template.periodKind === 'week';
  const showDay = weekly && report.rows.some((r) => r.day);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return report.rows;
    return report.rows.filter((r) => [r.driverName, r.driverKey, ...Object.values(r.data)]
      .some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q)));
  }, [report.rows, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Rows</CardTitle>
          <CardDescription>
            {rows.length ? `${formatNumber(at * PAGE + 1)}–${formatNumber(at * PAGE + shown.length)} of ${formatNumber(rows.length)}` : 'No matching rows'}
            {query && ` matching “${query}”`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search rows" placeholder="Search driver or value" className="w-60 pl-8" value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            />
          </div>
          <Button size="sm" variant="outline" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[36rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="pl-6">Driver</TableHead>
                {showDay && <TableHead>Day</TableHead>}
                {report.columns.map((c) => <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r, i) => {
                const bad = new Map(r.issues.map((x) => [x.column, x]));
                return (
                  <TableRow key={`${at}-${i}-${r.line}`}>
                    <TableCell className="pl-6 whitespace-nowrap">{r.driverName ?? r.driverKey ?? '—'}</TableCell>
                    {showDay && <TableCell className="whitespace-nowrap text-muted-foreground">{formatDay(r.day)}</TableCell>}
                    {report.columns.map((c) => {
                      const issue = bad.get(c);
                      return (
                        <TableCell
                          key={c} className={issue ? 'bg-red-50 text-red-800' : 'whitespace-nowrap'}
                          title={issue ? `${issue.problem}: "${issue.value}"` : undefined}
                        >
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
