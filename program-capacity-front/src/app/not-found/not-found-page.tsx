import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass size={24} aria-hidden />}
      title="This page does not exist"
      action={<Link to={ROUTES.programs.list()}>Back to programs</Link>}
    />
  );
}
