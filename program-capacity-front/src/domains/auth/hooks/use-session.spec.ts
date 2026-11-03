import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, setSession } from '@/api/session';
import { buildSession, buildUser } from '@/test/fixtures';
import { useSessionStore } from '../store';
import { useSession } from './use-session';

describe('useSession', () => {
  beforeEach(() => {
    clearSession();
    useSessionStore.setState({ status: 'unknown', user: null });
  });

  it('reports an unknown session before anyone has answered', () => {
    const { result } = renderHook(() => useSession());

    expect(result.current).toEqual({
      status: 'unknown',
      user: null,
      canOperate: false,
      isAdmin: false,
    });
  });

  it.each([
    { role: 'ADMIN', canOperate: true, isAdmin: true },
    { role: 'OPERATOR', canOperate: true, isAdmin: false },
    { role: 'VIEWER', canOperate: false, isAdmin: false },
  ] as const)('derives what a $role may do', ({ role, canOperate, isAdmin }) => {
    const user = buildUser({ role });
    act(() => setSession(buildSession({ user })));

    const { result } = renderHook(() => useSession());

    expect(result.current).toEqual({ status: 'authenticated', user, canOperate, isAdmin });
  });

  it('lets nobody operate or administer once signed out', () => {
    act(() => setSession(buildSession({ user: buildUser({ role: 'ADMIN' }) })));
    const { result } = renderHook(() => useSession());

    act(() => clearSession());

    expect(result.current).toEqual({
      status: 'anonymous',
      user: null,
      canOperate: false,
      isAdmin: false,
    });
  });

  it('follows the session as it changes', () => {
    const { result } = renderHook(() => useSession());

    act(() => setSession(buildSession({ user: buildUser({ role: 'VIEWER' }) })));
    expect(result.current.canOperate).toBe(false);

    act(() => setSession(buildSession({ user: buildUser({ role: 'OPERATOR' }) })));
    expect(result.current.canOperate).toBe(true);
  });
});
