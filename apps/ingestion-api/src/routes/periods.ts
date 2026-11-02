/** Reports by period: a daily report for one day, a weekly report for one Amazon week (latest upload per station). */
import { periodView } from '@platform/ingestion-service';
import { Hono } from 'hono';
import type { Env } from '../http.ts';

export const periods = new Hono<Env>();

/** `?template=` (default: the report with the newest data) and `?period=` (2026-07-01 or 2026-W27; default: its latest). */
for (const [path, kind] of [['/daily', 'day'], ['/weekly', 'week']] as const) {
  periods.get(path, async (c) => c.json(await periodView(c.get('ws'), {
    kind, template_id: c.req.query('template') || undefined, period: c.req.query('period') || undefined,
  })));
}
