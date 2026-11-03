import type { ReservationStatus } from '@/api/reservation/types';
import { Badge } from '@/components/ui/badge';

type ReservationStatusBadgeProps = {
  status: ReservationStatus;
};

export function ReservationStatusBadge({ status }: ReservationStatusBadgeProps) {
  return status === 'ACTIVE' ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="neutral">Released</Badge>
  );
}
