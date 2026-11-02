/** Amazon weeks: Sunday to Saturday; week 1 is the week containing 1 January (late-December days in that week are
 *  week 1 of the next year). Free of Node imports, so browser code can use it: '@platform/ingestion/weeks'. */
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function amazonWeek(day: string): { year: number; week: number; weekStart: string } {
  const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  const sunday = t - new Date(t).getUTCDay() * DAY;
  const year = new Date(sunday + 6 * DAY).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week1 = jan1 - new Date(jan1).getUTCDay() * DAY;
  return { year, week: Math.floor((sunday - week1) / (7 * DAY)) + 1, weekStart: isoDay(sunday) };
}

export function weekStart(year: number, week: number): string {
  const jan1 = Date.UTC(year, 0, 1);
  return isoDay(jan1 - new Date(jan1).getUTCDay() * DAY + (week - 1) * 7 * DAY);
}

/** '2026-W27' -> { year: 2026, week: 27 }; null when it isn't a week. */
export function parseWeek(s: string | null | undefined): { year: number; week: number } | null {
  const m = s?.match(/^(\d{4})-W(\d{1,2})$/);
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null;
}

export const formatWeek = (year: number, week: number) => `${year}-W${String(week).padStart(2, '0')}`;
