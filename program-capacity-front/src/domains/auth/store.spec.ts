import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, setSession } from '@/api/session';
import { buildSession, buildUser } from '@/test/fixtures';
import { useSessionStore } from './store';

describe('session store', () => {
  beforeEach(() => {
    clearSession();
    useSessionStore.setState({ status: 'unknown', user: null });
  });

  it('knows nothing about the session until the first answer', () => {
    expect(useSessionStore.getInitialState()).toEqual({ status: 'unknown', user: null });
  });

  it('is authenticated, with the user, once a session is set', () => {
    const user = buildUser({ email: 'admin@capacity.local', role: 'ADMIN' });

    setSession(buildSession({ user }));

    expect(useSessionStore.getState()).toEqual({ status: 'authenticated', user });
  });

  it('is anonymous, without a user, once the session is cleared', () => {
    setSession(buildSession());

    clearSession();

    expect(useSessionStore.getState()).toEqual({ status: 'anonymous', user: null });
  });

  it('follows the user of a rotated session', () => {
    setSession(buildSession({ user: buildUser({ role: 'VIEWER' }) }));

    setSession(buildSession({ user: buildUser({ role: 'ADMIN' }) }));

    expect(useSessionStore.getState().user?.role).toBe('ADMIN');
  });

  it('keeps no token: only the status and the user are client state', () => {
    setSession(buildSession({ accessToken: 'secret-token' }));

    expect(JSON.stringify(useSessionStore.getState())).not.toContain('secret-token');
  });
});
