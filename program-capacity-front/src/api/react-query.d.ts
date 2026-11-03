import type { ApiError } from '@/api/errors';

// The axios interceptor normalizes every failure, so this is what queries and mutations actually reject with.
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError;
  }
}
