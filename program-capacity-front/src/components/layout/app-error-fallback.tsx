import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function AppErrorFallback() {
  return (
    <EmptyState
      icon={<TriangleAlert size={24} aria-hidden />}
      title="This view failed to load"
      description="Your data is safe. Reloading usually fixes it."
      action={
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
    />
  );
}
