// Everything here formats the same on the server and in the browser (fixed locale, fixed timezone), so the
// server-rendered HTML matches the first browser render. Local times are swapped in after mount (LocalTime).
const LOCALE = 'en-US';
const day = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone: 'UTC' });
const utcDateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const localDateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

/** A moment in UTC ('Nov 1, 2026, 7:07 AM UTC'): what the server renders. */
export const formatUtcDateTime = (v: Date | string) => `${utcDateTime.format(new Date(v))} UTC`;

/** A moment in the viewer's own timezone: only after hydration (see LocalTime). */
export const formatLocalDateTime = (v: Date | string) => localDateTime.format(new Date(v));

/** A calendar day ('2026-07-01') shown as a date, without a timezone shift. */
export const formatDay = (v: string | null | undefined) => (v ? day.format(new Date(`${v}T00:00:00Z`)) : '—');

export const formatNumber = (n: number) => n.toLocaleString(LOCALE);

export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
