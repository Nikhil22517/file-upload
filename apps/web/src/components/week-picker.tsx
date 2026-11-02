import { amazonWeek, formatWeek, weekStart } from '@platform/ingestion/weeks';
import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = 'none';
const range = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const DAY = 86_400_000;

/** '2026-W27' -> 'W27 · Jun 28 – Jul 4, 2026' (Amazon weeks run Sunday to Saturday). */
export function weekLabel(value: string): string {
  const m = value.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return value;
  const start = Date.parse(`${weekStart(Number(m[1]), Number(m[2]))}T00:00:00Z`);
  return `W${m[2].padStart(2, '0')} · ${range.format(start)} – ${range.format(start + 6 * DAY)}, ${m[1]}`;
}

/** The last year of Amazon weeks, newest first. The browser's own week input uses ISO weeks (Monday to Sunday),
 *  which don't line up with Amazon's, so this lists Amazon weeks explicitly. */
export function WeekPicker({ value, onChange, id, allowNone = true }: {
  value: string; onChange: (week: string) => void; id?: string; allowNone?: boolean;
}) {
  const weeks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const { weekStart: thisSunday } = amazonWeek(today);
    return Array.from({ length: 53 }, (_, i) => {
      const day = new Date(Date.parse(`${thisSunday}T00:00:00Z`) - i * 7 * DAY).toISOString().slice(0, 10);
      const w = amazonWeek(day);
      return formatWeek(w.year, w.week);
    });
  }, []);
  const options = value && !weeks.includes(value) ? [value, ...weeks] : weeks;
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger id={id} className="w-64"><SelectValue placeholder="Choose a week" /></SelectTrigger>
      <SelectContent className="max-h-80">
        {allowNone && <SelectItem value={NONE}>No week</SelectItem>}
        {options.map((w) => <SelectItem key={w} value={w}>{weekLabel(w)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
