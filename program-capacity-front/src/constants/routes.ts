export const ROUTES = {
  login: () => '/login',
  programs: {
    list: () => '/programs',
    detail: (programId: string) => `/programs/${programId}`,
  },
  fxRates: () => '/fx-rates',
};
