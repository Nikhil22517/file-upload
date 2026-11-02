/** One report template: change what is kept, how it is read and what is computed; see its analytics. */
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type TemplateValues, TemplateEditor, toTemplateInput } from '@/components/template-editor';
import { weekLabel } from '@/components/week-picker';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDay, formatNumber } from '@/lib/format';
import { READER_LABELS } from '@/lib/templates';
import { editTemplate, loadTemplate, loadTemplateMetrics } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId/reports/templates/$templateId')({
  loader: async ({ params }) => {
    const [template, metrics] = await Promise.all([loadTemplate({ data: params }), loadTemplateMetrics({ data: params })]);
    return { template, metrics };
  },
  component: TemplatePage,
});

function TemplatePage() {
  const { workspaceId } = Route.useParams();
  const { template: t, metrics } = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(editTemplate);
  const [saving, setSaving] = useState(false);

  async function submit(values: TemplateValues) {
    setSaving(true);
    try {
      const res = await save({ data: { workspaceId, templateId: t.id, input: toTemplateInput(values) } });
      toast.success(`“${res.template.name}” saved (version ${res.template.version})`, {
        description: res.metricValues !== null
          ? `Analytics recalculated from the saved rows: ${formatNumber(res.metricValues)} values.`
          : 'Column, section and period changes apply to the next uploads.',
      });
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/$workspaceId/reports/templates" params={{ workspaceId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />Templates
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
          <Badge variant="outline">v{t.version}</Badge>
          <Badge variant="outline">{t.format.toUpperCase()}</Badge>
          {t.reader && <Badge variant="secondary">{READER_LABELS[t.reader] ?? t.reader}</Badge>}
        </div>
      </div>

      <AnalyticsResults metrics={metrics} />

      <TemplateEditor
        key={t.version} // start again from the saved template after each save
        initial={{ name: t.name, periodKind: t.periodKind as TemplateValues['periodKind'], columns: t.columns, sections: t.sections, metrics: t.metrics }}
        fileNamePattern={t.fileNamePattern}
        readerSections={t.readerSections}
        submitLabel="Save changes"
        saving={saving}
        onSubmit={submit}
        footerNote="Analytics are recalculated for every upload at once. Columns, sections and the period apply to new uploads."
      />
    </div>
  );
}

type Metrics = Awaited<ReturnType<typeof loadTemplateMetrics>>;

const groupText = (m: Metrics[number]) => {
  if (m.groupBy === 'driver') return m.groupLabel ? `${m.groupLabel} (${m.groupKey})` : m.groupKey;
  if (m.groupBy === 'day') return formatDay(m.day);
  if (m.groupBy === 'week') return weekLabel(m.groupKey);
  return 'Whole upload';
};
const valueText = (v: number | null) => (v === null ? '—' : Number.isInteger(v) ? formatNumber(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** The computed analytics, one table per analytic, newest uploads first. */
function AnalyticsResults({ metrics }: { metrics: Metrics }) {
  const byMetric = new Map<string, Metrics>();
  for (const m of metrics) byMetric.set(m.metricKey, [...(byMetric.get(m.metricKey) ?? []), m]);
  if (!byMetric.size) {
    return (
      <Card>
        <CardContent>
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BarChart3 /></EmptyMedia>
              <EmptyTitle>No analytics yet</EmptyTitle>
              <EmptyDescription>Add analytics below; they are worked out for every upload of this report already imported.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[...byMetric.entries()].map(([key, values]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle className="text-base">{values[0].metricName}</CardTitle>
            <CardDescription>{formatNumber(values.length)} values across {formatNumber(new Set(values.map((v) => v.fileId)).size)} uploads</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-72 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="pl-6">Upload</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead className="pr-6 text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {values.slice(0, 200).map((m) => (
                    <TableRow key={`${m.fileId}-${m.groupKey}`}>
                      <TableCell className="max-w-48 truncate pl-6 text-muted-foreground">{m.fileName}</TableCell>
                      <TableCell className="whitespace-nowrap">{groupText(m)}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{valueText(m.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
