import type { Session, User } from '@/api/auth/types';
import type { FxRate } from '@/api/fx-rate/types';
import type { Page } from '@/api/page';
import type {
  LedgerEntry,
  Program,
  ProgramAvailability,
  Reconciliation,
} from '@/api/program/types';
import type { Reservation, ReservationDetail } from '@/api/reservation/types';

export const API = '*/api/v1';

export const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'operator@test.local',
  role: 'OPERATOR',
  ...overrides,
});

export const buildSession = (overrides: Partial<Session> = {}): Session => ({
  accessToken: 'access-token',
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  user: buildUser(),
  ...overrides,
});

export const buildAvailability = (
  overrides: Partial<ProgramAvailability> = {},
): ProgramAvailability => ({
  programId: 'program-1',
  currency: 'USD',
  creditLimit: '10000000.00',
  reserved: '2500000.00',
  available: '7500000.00',
  isOverLimit: false,
  version: 3,
  lastReconciledAt: null,
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const buildProgram = (overrides: Partial<Program> = {}): Program => ({
  id: 'program-1',
  code: 'PRG-ACME',
  name: 'Acme Supply Chain',
  currency: 'USD',
  availability: buildAvailability(),
  createdAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
});

export const buildReservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: 'reservation-1',
  programId: 'program-1',
  invoiceId: 'INV-1',
  status: 'ACTIVE',
  source: 'API',
  invoiceCurrency: 'USD',
  invoiceAmount: '1000.00',
  outstandingInvoiceAmount: '1000.00',
  programCurrency: 'USD',
  programAmount: '1000.00',
  outstandingProgramAmount: '1000.00',
  fx: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const buildReservationDetail = (
  overrides: Partial<ReservationDetail> = {},
): ReservationDetail => ({
  reservation: buildReservation(),
  releases: [],
  ...overrides,
});

export const buildLedgerEntry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'entry-1',
  programVersion: 1,
  type: 'RESERVED',
  source: 'API',
  reservedDelta: '1000.00',
  creditLimitDelta: '0.00',
  reservedAfter: '1000.00',
  creditLimitAfter: '10000000.00',
  invoiceId: 'INV-1',
  actor: 'operator@test.local',
  createdAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const buildReconciliation = (overrides: Partial<Reconciliation> = {}): Reconciliation => ({
  id: 'reconciliation-1',
  treasurySequence: 7,
  asOf: '2026-11-01T12:00:00.000Z',
  creditLimitBefore: '10000000.00',
  creditLimitAfter: '10000000.00',
  reservedBefore: '1000.00',
  reservedAfter: '1000.00',
  reservedDrift: '0.00',
  positionsReceived: 1,
  insertedCount: 0,
  adjustedCount: 0,
  closedCount: 0,
  inFlightSkippedCount: 0,
  adjustments: [],
  createdAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const buildFxRate = (overrides: Partial<FxRate> = {}): FxRate => ({
  baseCurrency: 'EUR',
  quoteCurrency: 'USD',
  rate: '1.25',
  asOf: '2026-11-01T12:00:00.000Z',
  isStale: false,
  ...overrides,
});

export const buildPage = <T>(items: T[], overrides: Partial<Page<T>> = {}): Page<T> => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  ...overrides,
});
