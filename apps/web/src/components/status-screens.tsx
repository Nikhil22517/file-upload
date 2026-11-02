import { Link, type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import { FileQuestion, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export function NotFound() {
  return (
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
        <EmptyTitle>Not found</EmptyTitle>
        <EmptyDescription>This workspace or upload doesn’t exist, or the link is out of date.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button asChild variant="outline"><Link to="/">Go to workspaces</Link></Button></EmptyContent>
    </Empty>
  );
}

export function ErrorScreen({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon"><TriangleAlert /></EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{error instanceof Error ? error.message : String(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline" onClick={() => router.invalidate()}>Try again</Button></EmptyContent>
    </Empty>
  );
}
