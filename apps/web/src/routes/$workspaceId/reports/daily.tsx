/** Daily reports: one report for one day, the latest by default. */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { PeriodReportPage } from '@/components/period-report';
import { loadPeriodView } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId/reports/daily')({
  validateSearch: z.object({ template: z.string().optional().catch(undefined), period: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => loadPeriodView({
    data: { workspaceId: params.workspaceId, kind: 'day', templateId: deps.template, period: deps.period },
  }),
  head: () => ({ meta: [{ title: 'Daily reports · LMDmax' }] }),
  component: Page,
});

function Page() {
  const { workspaceId } = Route.useParams();
  const view = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Daily reports</h1>
        <p className="text-sm text-muted-foreground">Each daily report for one day: the latest by default, or any date you pick.</p>
      </div>
      <PeriodReportPage view={view} workspaceId={workspaceId} go={(search) => navigate({ search })} />
    </div>
  );
}
