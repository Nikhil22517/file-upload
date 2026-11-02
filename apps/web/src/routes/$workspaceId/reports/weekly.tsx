/** Weekly reports: one report for one week, the latest by default. */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { PeriodReportPage } from '@/components/period-report';
import { loadPeriodView } from '@/server/reports.functions';

export const Route = createFileRoute('/$workspaceId/reports/weekly')({
  validateSearch: z.object({ template: z.string().optional().catch(undefined), period: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => loadPeriodView({
    data: { workspaceId: params.workspaceId, kind: 'week', templateId: deps.template, period: deps.period },
  }),
  head: () => ({ meta: [{ title: 'Weekly reports · LMDmax' }] }),
  component: Page,
});

function Page() {
  const { workspaceId } = Route.useParams();
  const view = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Weekly reports</h1>
        <p className="text-sm text-muted-foreground">Each weekly report for one Amazon week (Sunday to Saturday): the latest by default, or any week you pick.</p>
      </div>
      <PeriodReportPage view={view} workspaceId={workspaceId} go={(search) => navigate({ search })} />
    </div>
  );
}
