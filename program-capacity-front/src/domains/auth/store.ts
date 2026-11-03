import { create } from 'zustand';
import { subscribeSession } from '@/api/session';
import type { User } from '@/api/auth/types';

type SessionStoreState = {
  // "unknown" until the first refresh attempt answers whether the refresh cookie is still good.
  status: 'unknown' | 'authenticated' | 'anonymous';
  user: User | null;
};

export const useSessionStore = create<SessionStoreState>()(() => ({
  status: 'unknown',
  user: null,
}));

subscribeSession((session) =>
  useSessionStore.setState(
    session ? { status: 'authenticated', user: session.user } : { status: 'anonymous', user: null },
  ),
);
