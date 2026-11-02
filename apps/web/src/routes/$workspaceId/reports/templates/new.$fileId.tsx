/** Teach a report: set up its template from the first upload (a guessed draft the user confirms or corrects). */
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, FileText, Info } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { type TemplateValues, TemplateEditor, toTemplateInput } from '@/components/template-editor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { plural } from '@/lib/format';
import { READER_LABELS } from '@/lib/templates';
import { loadFile, loadTemplateDraft, saveTemplate } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId/reports/templates/new/$fileId')({
  validateSearch: z.object({ headerRow: z.number().int().min(0).max(14).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ headerRow: search.headerRow }),
  loader: async ({ params, deps }) => {
    const file = await loadFile({ data: params });
    if (file.stage !== 'needs_template') return { file, draft: null };
    return { file, draft: await loadTemplateDraft({ data: { ...params, headerRow: deps.headerRow } }) };
  },
  component: TeachPage,
});

type Draft = Awaited<ReturnType<typeof loadTemplateDraft>>;

function TeachPage() {
  const { file, draft } = Route.useLoaderData();
  const { workspaceId, fileId } = Route.useParams();
  const back = (
    <Link to="/$workspaceId/reports/files/$fileId" params={{ workspaceId, fileId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" />{file.fileName}
    </Link>
  );
  if (!draft) {
    return (
      <div className="space-y-4">
        {back}
        <Alert><Info /><AlertTitle>This upload does not need a template</AlertTitle><AlertDescription>It is {file.stage.replaceAll('_', ' ')}.</AlertDescription></Alert>
      </div>
    );
  }
  // remount the editor when the draft changes (another header row), so its state starts from the new guess
  return <div className="space-y-6">{back}<Teach key={`${draft.headerRow}`} draft={draft} isPdf={file.format === 'pdf'} /></div>;
}

function Teach({ draft, isPdf }: { draft: Draft; isPdf: boolean }) {
  const { workspaceId, fileId } = Route.useParams();
  const navigate = useNavigate();
  const save = useServerFn(saveTemplate);
  const [saving, setSaving] = useState(false);

  async function submit(values: TemplateValues) {
    setSaving(true);
    try {
      const res = await save({
        data: { workspaceId, input: { file_id: fileId, header_row: draft.headerRow ?? undefined, ...toTemplateInput(values) } },
      });
      const imported = res.files.filter((f) => f.stage === 'imported');
      const rowsIn = imported.reduce((n, f) => n + (f.rowCount ?? 0), 0);
      toast.success(`Template “${res.template.name}” saved`, {
        description: imported.length
          ? `${plural(imported.length, 'upload')} imported (${plural(rowsIn, 'row')}).`
          : `This upload is now ${res.files[0]?.stage.replaceAll('_', ' ')}.`,
      });
      await navigate({ to: '/$workspaceId/reports/files/$fileId', params: { workspaceId, fileId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Teach this report</h1>
        <p className="text-muted-foreground">
          We guessed its layout. Choose what to keep and how to read it, add any analytics, and save. Later uploads with
          the same columns are recognised and imported automatically.
          {draft.reader && ` Read with the ${READER_LABELS[draft.reader] ?? draft.reader} reader.`}
        </p>
      </div>
      {isPdf && !draft.reader && (
        <Alert>
          <FileText />
          <AlertTitle>We can store this PDF, but not read it yet</AlertTitle>
          <AlertDescription>
            No PDF reader knows this layout, so its contents can’t become rows. Saving a template still files later
            uploads of it under this report; a reader for the layout can be added later to get its data.
          </AlertDescription>
        </Alert>
      )}
      {draft.headerRow !== null && draft.periodSource === 'ask' && (
        <Alert>
          <Info />
          <AlertTitle>No period found</AlertTitle>
          <AlertDescription>Neither a column nor the file name gives the period, so each upload will ask for it. Mark a date or week column below if there is one.</AlertDescription>
        </Alert>
      )}
      <TemplateEditor
        initial={{ name: draft.name, periodKind: draft.periodKind, columns: draft.columns, sections: null, metrics: [] }}
        fileNamePattern={draft.fileNamePattern}
        readerSections={draft.sections}
        samples={draft.samples}
        submitLabel="Save template and import"
        saving={saving}
        onSubmit={submit}
        extraSettings={draft.reader || draft.headerRow === null ? null : (
          <div className="grid gap-1.5">
            <Label>Header row</Label>
            <Select
              value={String(draft.headerRow)}
              onValueChange={(v) => navigate({ to: '.', search: { headerRow: Number(v) }, replace: true })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 15 }, (_, i) => <SelectItem key={i} value={String(i)}>Row {i + 1}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The row holding the column names. Change it if the columns below look wrong.</p>
          </div>
        )}
      />
    </div>
  );
}
