import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/$workspaceId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$workspaceId/reports', params });
  },
});
