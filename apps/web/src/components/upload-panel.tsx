import { Link, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { FileUp, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { StageBadge } from '@/components/stage-badge';
import { WeekPicker } from '@/components/week-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBytes, formatNumber } from '@/lib/format';
import { HELD, stageOf } from '@/lib/stages';
import { uploadFile } from '@/server/reports.functions';
import { cn } from 'cn';

const MAX_FILES = 25;
const MAX_MB = 25;
const ACCEPT = '.csv,.xlsx,.pdf';

type Result = Awaited<ReturnType<typeof uploadFile>>;
interface Item { key: string; file: File; status: 'waiting' | 'uploading' | 'done' | 'error'; result?: Result; error?: string }

export function UploadPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const upload = useServerFn(uploadFile);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [referenceDate, setReferenceDate] = useState('');
  const [referenceWeek, setReferenceWeek] = useState('');
  const [dragging, setDragging] = useState(false);
  const busy = items.some((i) => i.status === 'uploading');
  const waiting = items.filter((i) => i.status === 'waiting');

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...list].map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, status: 'waiting' as const }));
    setItems((prev) => [...prev, ...next]);
  };
  const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function start() {
    let imported = 0;
    let held = 0;
    let failed = 0;
    if (waiting.length > MAX_FILES) toast.info(`Uploading the first ${MAX_FILES} files; the rest stay ready for the next round.`);
    for (const item of waiting.slice(0, MAX_FILES)) { // one request per file: each shows its own outcome
      if (item.file.size > MAX_MB * 1024 * 1024) {
        patch(item.key, { status: 'error', error: `Larger than ${MAX_MB} MB` });
        failed++;
        continue;
      }
      patch(item.key, { status: 'uploading' });
      const form = new FormData();
      form.append('workspaceId', workspaceId);
      form.append('file', item.file);
      if (referenceDate) form.append('referenceDate', referenceDate);
      if (referenceWeek) form.append('referenceWeek', referenceWeek);
      try {
        const result = await upload({ data: form });
        patch(item.key, { status: 'done', result });
        if (result.stage === 'imported' || result.stage === 'stored_file_only') imported++;
        else if (HELD.has(result.stage)) held++;
        else failed++;
      } catch (e) {
        patch(item.key, { status: 'error', error: e instanceof Error ? e.message : String(e) });
        failed++;
      }
    }
    await router.invalidate();
    const parts = [imported && `${imported} imported`, held && `${held} need your attention`, failed && `${failed} failed`].filter(Boolean);
    (failed ? toast.warning : toast.success)(`Upload finished: ${parts.join(', ')}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload reports</CardTitle>
        <CardDescription>
          Drop Amazon, Netradyne or your own exports (CSV, XLSX or PDF, up to {MAX_FILES} files of {MAX_MB} MB).
          Each file is recognised automatically; anything unclear waits for you below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          )}
        >
          <FileUp className="size-8 text-muted-foreground" />
          <span className="font-medium">Drop files here or click to choose</span>
          <span className="text-sm text-muted-foreground">.csv · .xlsx · .pdf</span>
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />

        {items.length > 0 && (
          <ul className="divide-y rounded-md border">
            {items.map((i) => <UploadRow key={i.key} item={i} workspaceId={workspaceId} onRemove={() => setItems((p) => p.filter((x) => x.key !== i.key))} />)}
          </ul>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="reference-date">Report date (daily reports)</Label>
              <Input id="reference-date" type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className="w-44" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reference-week">Report week (weekly reports)</Label>
              <WeekPicker id="reference-week" value={referenceWeek} onChange={setReferenceWeek} />
            </div>
            <p className="basis-full text-xs text-muted-foreground">
              Optional. Only used for files whose columns and name don’t give their period; each file takes the one its report needs.
            </p>
          </div>
          <div className="flex gap-2">
            {items.some((i) => i.status !== 'waiting') && !busy && (
              <Button variant="ghost" onClick={() => setItems((p) => p.filter((i) => i.status === 'waiting'))}>Clear finished</Button>
            )}
            <Button onClick={start} disabled={busy || waiting.length === 0}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? 'Uploading…' : waiting.length ? `Upload ${waiting.length} file${waiting.length === 1 ? '' : 's'}` : 'Upload'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadRow({ item, workspaceId, onRemove }: { item: Item; workspaceId: string; onRemove: () => void }) {
  const r = item.result;
  const message = item.error ?? r?.error ?? r?.warnings?.[0]?.message
    ?? (r?.stage === 'imported' ? `${formatNumber(r.rowCount ?? 0)} rows${r.issueCount ? `, ${r.issueCount} with unreadable values` : ''}` : r && stageOf(r.stage).hint);
  const report = r?.template?.name;
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.file.name}</div>
        <div className="truncate text-muted-foreground">
          {item.status === 'waiting' && `${formatBytes(item.file.size)} · ready`}
          {item.status === 'uploading' && 'Uploading and reading…'}
          {(item.status === 'done' || item.status === 'error') && [report, message].filter(Boolean).join(' · ')}
        </div>
      </div>
      {item.status === 'uploading' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {item.status === 'error' && <StageBadge stage="failed" />}
      {r && <StageBadge stage={r.stage} />}
      {r?.id && HELD.has(r.stage) && (
        <Button asChild size="sm" variant="outline">
          {r.stage === 'needs_template'
            ? <Link to="/$workspaceId/reports/templates/new/$fileId" params={{ workspaceId, fileId: r.id }}>Teach template</Link>
            : <Link to="/$workspaceId/reports/files/$fileId" params={{ workspaceId, fileId: r.id }}>Review</Link>}
        </Button>
      )}
      {item.status === 'waiting' && (
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove ${item.file.name}`}><X /></Button>
      )}
    </li>
  );
}
