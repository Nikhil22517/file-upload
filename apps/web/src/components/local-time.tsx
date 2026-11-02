import { useEffect, useState } from 'react';
import { formatLocalDateTime, formatUtcDateTime } from '@/lib/format';

/** A timestamp in the viewer's timezone. The server can't know that timezone, so the server and the first
 *  browser render both show UTC (no hydration mismatch); the local time replaces it once the page is live. */
export function LocalTime({ value }: { value: Date | string | null | undefined }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!value) return <>—</>;
  const iso = new Date(value).toISOString();
  return <time dateTime={iso} title={formatUtcDateTime(value)}>{mounted ? formatLocalDateTime(value) : formatUtcDateTime(value)}</time>;
}
