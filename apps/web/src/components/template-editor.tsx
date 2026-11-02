/** Everything a user controls on a report template: what to keep from the report (columns, PDF sections), how to
 *  read it (types, roles, the period) and what to compute from it (analytics). Used to teach and to edit a template. */
import {
  COLUMN_ROLES, COLUMN_TYPES, type ColumnRole, type ColumnSpec, type ColumnType, METRIC_GROUPS, METRIC_OPS,
  type MetricGroup, type MetricOp, type MetricSpec, type PeriodKind, periodSourceOf,
} from '@platform/ingestion/columns';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PERIOD_SOURCES } from '@/lib/templates';

const TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Text', id: 'ID / code', int: 'Whole number', decimal: 'Decimal', percent: 'Percent',
  date: 'Date', datetime: 'Date and time', week: 'Week (2026-W26)', yn: 'Yes / No',
};
const ROLE_LABELS: Record<ColumnRole, string> = { driver_id: 'Driver ID', driver_name: 'Driver name', date: 'Report date', week: 'Report week' };
const OP_LABELS: Record<MetricOp, string> = { sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum', count: 'Count', count_distinct: 'Count distinct' };
const GROUP_LABELS: Record<MetricGroup, string> = { file: 'Whole upload', driver: 'Per driver', day: 'Per day', week: 'Per week' };
const NONE = 'none';
const NUMERIC: ColumnType[] = ['int', 'decimal', 'percent'];

export interface TemplateValues {
  name: string;
  periodKind: PeriodKind;
  columns: ColumnSpec[];
  sections: string[] | null;    // null = keep every section
  metrics: MetricSpec[];
}

export interface TemplateEditorProps {
  initial: TemplateValues;
  fileNamePattern: string;
  readerSections: string[];     // sections the PDF reader writes (empty for table files)
  samples?: Record<string, string[]>;
  extraSettings?: ReactNode;    // e.g. the header row picker while teaching
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: TemplateValues) => void;
  footerNote?: ReactNode;
}

type DraftMetric = MetricSpec & { uid: number };
let uid = 0;
const withUid = (m: MetricSpec): DraftMetric => ({ ...m, uid: ++uid });

export function TemplateEditor(props: TemplateEditorProps) {
  const { initial, fileNamePattern, readerSections, samples } = props;
  const [name, setName] = useState(initial.name);
  const [periodKind, setPeriodKind] = useState<PeriodKind>(initial.periodKind);
  const [columns, setColumns] = useState(initial.columns.map((c, i) => ({ ...c, i })));
  const [sections, setSections] = useState<string[] | null>(initial.sections);
  const [metrics, setMetrics] = useState<DraftMetric[]>(initial.metrics.map(withUid));
  const periodSource = periodSourceOf(columns, fileNamePattern);

  const setCol = (i: number, patch: Partial<ColumnSpec>) => setColumns((cols) => cols.map((c) => {
    if (c.i === i) return { ...c, ...patch };
    return patch.role && c.role === patch.role ? { ...c, role: null } : c; // a role belongs to one column
  }));
  const setMetric = (id: number, patch: Partial<MetricSpec>) => setMetrics((ms) => ms.map((m) => (m.uid === id ? { ...m, ...patch } : m)));
  const keptSections = sections ?? readerSections;
  const toggleSection = (s: string, on: boolean) => {
    const next = on ? [...new Set([...keptSections, s])] : keptSections.filter((x) => x !== s);
    setSections(next.length === readerSections.length ? null : next);
  };
  const columnOptions = columns.filter((c) => c.include !== false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    props.onSubmit({
      name: name.trim(), periodKind, sections,
      columns: columns.map(({ i: _i, ...c }) => c),
      metrics: metrics.map(({ uid: _u, ...m }) => ({ ...m, name: m.name.trim() })),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Report</CardTitle>
          <CardDescription>What this report is called and which period one upload of it covers.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-name">Report name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fuel log" required maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label>Each upload covers</Label>
            <Select value={periodKind} onValueChange={(v) => setPeriodKind(v as PeriodKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">One day (a daily report)</SelectItem>
                <SelectItem value="week">One Amazon week (a weekly report)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              When a file’s columns and name don’t say, the uploader picks a {periodKind === 'week' ? 'week' : 'date'}.
            </p>
          </div>
          <div className="grid content-start gap-1.5 text-sm">
            <span className="font-medium">Period comes from</span>
            <span>{PERIOD_SOURCES[periodSource]}</span>
            <span className="font-mono text-xs text-muted-foreground">{fileNamePattern}</span>
          </div>
          {props.extraSettings}
        </CardContent>
      </Card>

      {readerSections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What to keep from the PDF</CardTitle>
            <CardDescription>
              The PDF is read into sections. Driver rows hold each driver’s values; the others hold the report’s own
              values (overall standing, each metric and its tier, summary counts). Keep the ones you need.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {readerSections.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <Checkbox checked={keptSections.includes(s)} onCheckedChange={(on) => toggleSection(s, on === true)} />
                {s}
              </label>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Columns</CardTitle>
          <CardDescription>
            Untick a column to skip it. Mark which column identifies the driver and which holds the date, and fix any type guessed wrong.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-6">Keep</TableHead>
                  <TableHead>Column</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Used as</TableHead>
                  {samples && <TableHead className="pr-6">Sample values</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {columns.map((c) => (
                  <TableRow key={c.i} className={c.include === false ? 'opacity-50' : undefined}>
                    <TableCell className="pl-6">
                      <Checkbox checked={c.include !== false} onCheckedChange={(on) => setCol(c.i, { include: on === true })} aria-label={`Keep ${c.header}`} />
                    </TableCell>
                    <TableCell className="font-medium">{c.header}</TableCell>
                    <TableCell>
                      <Select value={c.type} onValueChange={(v) => setCol(c.i, { type: v as ColumnType })}>
                        <SelectTrigger className="w-44" aria-label={`Type of ${c.header}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{COLUMN_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c.role ?? NONE} onValueChange={(v) => setCol(c.i, { role: v === NONE ? null : (v as ColumnRole) })}>
                        <SelectTrigger className="w-40" aria-label={`Use of ${c.header}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {COLUMN_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {samples && (
                      <TableCell className="max-w-80 truncate pr-6 font-mono text-xs text-muted-foreground">
                        {samples[c.key]?.join(' · ') || '—'}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Analytics</CardTitle>
            <CardDescription>
              Numbers to work out from every upload of this report, e.g. total packages per driver or average POD per week.
              They are saved with each upload and recalculated when you change them here.
            </CardDescription>
          </div>
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => setMetrics((ms) => [...ms, withUid({
              key: '', name: '', op: 'sum', by: 'file', where: null,
              column: columnOptions.find((c) => NUMERIC.includes(c.type))?.key ?? columnOptions[0]?.key ?? null,
            })])}
          >
            <Plus />Add analytic
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {metrics.length === 0 && <p className="text-sm text-muted-foreground">No analytics yet. The rows are saved either way.</p>}
          {metrics.map((m) => (
            <div key={m.uid} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1.4fr_0.8fr_1.2fr_0.9fr_auto]">
              <Input aria-label="Analytic name" value={m.name} onChange={(e) => setMetric(m.uid, { name: e.target.value })} placeholder="Name, e.g. Total packages" required />
              <Select value={m.op} onValueChange={(v) => setMetric(m.uid, { op: v as MetricOp })}>
                <SelectTrigger aria-label="Calculation"><SelectValue /></SelectTrigger>
                <SelectContent>{METRIC_OPS.map((o) => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m.column ?? NONE} onValueChange={(v) => setMetric(m.uid, { column: v === NONE ? null : v })}>
                <SelectTrigger aria-label="Column"><SelectValue placeholder="Column" /></SelectTrigger>
                <SelectContent>
                  {m.op === 'count' && <SelectItem value={NONE}>Rows</SelectItem>}
                  {columnOptions.map((c) => <SelectItem key={c.i} value={c.key}>{c.header}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={m.by} onValueChange={(v) => setMetric(m.uid, { by: v as MetricGroup })}>
                <SelectTrigger aria-label="Grouping"><SelectValue /></SelectTrigger>
                <SelectContent>{METRIC_GROUPS.map((g) => <SelectItem key={g} value={g}>{GROUP_LABELS[g]}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove analytic" onClick={() => setMetrics((ms) => ms.filter((x) => x.uid !== m.uid))}>
                <Trash2 />
              </Button>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground md:col-span-5">
                <span>Only rows where</span>
                <Select value={m.where?.column ?? NONE} onValueChange={(v) => setMetric(m.uid, { where: v === NONE ? null : { column: v, equals: m.where?.equals ?? '' } })}>
                  <SelectTrigger className="h-8 w-48" aria-label="Filter column"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(all rows)</SelectItem>
                    {columnOptions.map((c) => <SelectItem key={c.i} value={c.key}>{c.header}</SelectItem>)}
                  </SelectContent>
                </Select>
                {m.where && (
                  <>
                    <span>is</span>
                    <Input aria-label="Filter value" className="h-8 w-44" value={m.where.equals} placeholder="e.g. Driver"
                      onChange={(e) => setMetric(m.uid, { where: { column: m.where!.column, equals: e.target.value } })} />
                  </>
                )}
                {m.op !== 'count' && m.column && !NUMERIC.includes(columns.find((c) => c.key === m.column)?.type ?? 'text') && m.op !== 'count_distinct' && (
                  <Badge variant="outline" className="border-amber-300 text-amber-800">This column isn’t a number</Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {props.footerNote && <span className="mr-auto text-sm text-muted-foreground">{props.footerNote}</span>}
        <Button type="submit" disabled={props.saving}>{props.saving && <Loader2 className="animate-spin" />}{props.submitLabel}</Button>
      </div>
    </form>
  );
}

/** The editor's values as the template API takes them. */
export const toTemplateInput = (v: TemplateValues) => ({
  name: v.name || undefined,
  period_kind: v.periodKind,
  sections: v.sections,
  columns: v.columns.map((c) => ({ key: c.key, type: c.type, role: c.role, include: c.include !== false })),
  metrics: v.metrics.map((m) => ({ ...(m.key ? { key: m.key } : {}), name: m.name, op: m.op, column: m.column, by: m.by, where: m.where?.column ? m.where : null })),
});
