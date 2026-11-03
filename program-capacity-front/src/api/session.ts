import axios from 'axios';
import { env } from '@/env';
import { authRoutes } from '@/api/auth/routes';
import { normalizeApiError } from '@/api/errors';
import type { Session } from '@/api/auth/types';

/**
 * The one place the API layer gets its access token from. Kept in memory on purpose: nothing in
 * localStorage for an XSS to read. The long-lived refresh token is an httpOnly cookie, so a reload
 * restores the session through refreshSession().
 */
type SessionListener = (session: Session | null) => void;

const EXPIRY_MARGIN_MS = 30_000;

// No interceptors here: a failing refresh must not trigger another refresh.
const refreshClient = axios.create({ baseURL: env.VITE_API_URL, withCredentials: true });

const listeners = new Set<SessionListener>();
let currentSession: Session | null = null;
let refreshInFlight: Promise<Session> | null = null;
let sessionGeneration = 0;

export const getAccessToken = () => currentSession?.accessToken ?? null;

export const isAccessTokenExpiringSoon = () =>
  currentSession !== null &&
  new Date(currentSession.accessTokenExpiresAt).getTime() - Date.now() < EXPIRY_MARGIN_MS;

export const setSession = (session: Session) => {
  currentSession = session;
  listeners.forEach((listener) => listener(session));
};

export const clearSession = () => {
  sessionGeneration += 1;
  currentSession = null;
  listeners.forEach((listener) => listener(null));
};

export const subscribeSession = (listener: SessionListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Single-flight: every caller racing on an expired token shares one rotation. */
export const refreshSession = (): Promise<Session> => {
  const startedInGeneration = sessionGeneration;
  refreshInFlight ??= refreshClient
    .post<Session>(authRoutes.refresh())
    .then(({ data }) => {
      // Signed out while this was on its way: a late answer must not bring the session back.
      if (startedInGeneration === sessionGeneration) setSession(data);
      return data;
    })
    .catch((error: unknown) => {
      const apiError = normalizeApiError(error);
      // Only a rejected refresh ends the session; a network blip must not sign anyone out.
      if (apiError.status === 401) clearSession();
      throw apiError;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};
