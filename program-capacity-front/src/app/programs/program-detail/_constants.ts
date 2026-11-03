import { ArrowDownLeft, ArrowUpRight, Gauge, Plus, Scale, type LucideIcon } from 'lucide-react';
import type { LedgerEntryType, Reconciliation } from '@/api/program/types';
import type { ReservationStatus } from '@/api/reservation/types';

export const LEDGER_ENTRY_LABELS: Record<LedgerEntryType, string> = {
  PROGRAM_CREATED: 'Program created',
  RESERVED: 'Reserved',
  RELEASED: 'Released',
  LIMIT_CHANGED: 'Limit updated',
  RECONCILED: 'Reconciled',
};

export const LEDGER_ENTRY_ICONS: Record<LedgerEntryType, LucideIcon> = {
  PROGRAM_CREATED: Plus,
  RESERVED: ArrowUpRight,
  RELEASED: ArrowDownLeft,
  LIMIT_CHANGED: Gauge,
  RECONCILED: Scale,
};

export const ADJUSTMENT_ACTION_LABELS: Record<
  Reconciliation['adjustments'][number]['action'],
  string
> = {
  INSERTED: 'Added',
  ADJUSTED: 'Adjusted',
  CLOSED: 'Closed',
};

export type ReservationStatusFilter = ReservationStatus | 'ALL';

export const RESERVATION_STATUS_OPTIONS: { value: ReservationStatusFilter; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'ALL', label: 'All' },
];

export type ActivityView = 'ledger' | 'reconciliations';

export const ACTIVITY_VIEW_OPTIONS: { value: ActivityView; label: string }[] = [
  { value: 'ledger', label: 'Ledger' },
  { value: 'reconciliations', label: 'Reconciliations' },
];
