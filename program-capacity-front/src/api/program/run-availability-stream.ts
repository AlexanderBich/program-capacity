import { fetchEventSource } from '@microsoft/fetch-event-source';
import { env } from '@/env';
import { getAccessToken, isAccessTokenExpiringSoon, refreshSession } from '@/api/session';
import { computeReconnectDelayMs } from './compute-reconnect-delay';
import { programRoutes } from './routes';
import type { ProgramAvailability } from './types';

export type AvailabilityStreamStatus = 'connecting' | 'live' | 'reconnecting';

type AvailabilityStreamHandlers = {
  signal: AbortSignal;
  onAvailability: (availability: ProgramAvailability) => void;
  onStatusChange: (status: AvailabilityStreamStatus) => void;
};

// The server sends a heartbeat every 20 seconds, so this much silence means the connection is dead.
const SILENCE_TIMEOUT_MS = 50_000;

const connectOnce = (handlers: AvailabilityStreamHandlers) => {
  const connection = new AbortController();
  let silenceTimer: ReturnType<typeof setTimeout>;
  const restartSilenceTimer = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => connection.abort(), SILENCE_TIMEOUT_MS);
  };
  const abortConnection = () => connection.abort();
  handlers.signal.addEventListener('abort', abortConnection);

  // fetch-based, because native EventSource cannot send the Authorization header.
  return fetchEventSource(`${env.VITE_API_URL}${programRoutes.availabilityStream()}`, {
    signal: connection.signal,
    openWhenHidden: true,
    fetch: async (input, init) => {
      if (isAccessTokenExpiringSoon()) await refreshSession();
      return fetch(input, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${getAccessToken()}` },
      });
    },
    onopen: async (response) => {
      if (response.status === 401) await refreshSession();
      if (!response.ok) throw new Error(`Availability stream refused: ${response.status}`);
      handlers.onStatusChange('live');
      restartSilenceTimer();
    },
    onmessage: (message) => {
      restartSilenceTimer();
      if (message.event === 'availability') {
        handlers.onAvailability(JSON.parse(message.data));
      }
    },
    // Rethrowing hands retries to the loop below instead of the library's own.
    onerror: (error) => {
      throw error;
    },
  }).finally(() => {
    clearTimeout(silenceTimer);
    handlers.signal.removeEventListener('abort', abortConnection);
  });
};

/** Keeps a stream open until aborted. The server ends it when the access token expires; so does this loop's refresh. */
export const runAvailabilityStream = async (handlers: AvailabilityStreamHandlers) => {
  handlers.onStatusChange('connecting');
  let failedAttempts = 0;
  while (!handlers.signal.aborted) {
    let wentLive = false;
    await connectOnce({
      ...handlers,
      onStatusChange: (status) => {
        wentLive = status === 'live';
        handlers.onStatusChange(status);
      },
    }).catch(() => undefined);
    if (handlers.signal.aborted) return;

    // A stream that worked and ended, as every one does when its token expires, starts the count over.
    failedAttempts = wentLive ? 0 : failedAttempts + 1;
    handlers.onStatusChange('reconnecting');
    const delayMs = computeReconnectDelayMs(failedAttempts, Math.random());
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
};
