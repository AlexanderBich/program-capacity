export const programRoutes = {
  all: () => '/programs',
  detail: (programId: string) => `/programs/${programId}`,
  availabilityStream: () => '/programs/availability/stream',
  ledgerEntries: (programId: string) => `/programs/${programId}/ledger-entries`,
  reconciliations: (programId: string) => `/programs/${programId}/reconciliations`,
};
