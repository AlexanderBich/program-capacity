import { useEffect } from 'react';
import { refreshSession } from '@/api/session';
import { useSessionStore } from '../store';

/** The access token lives in memory, so a page load asks the refresh cookie for a new one. */
export const useSessionRestore = () => {
  useEffect(() => {
    refreshSession().catch(() => {
      useSessionStore.setState({ status: 'anonymous', user: null });
    });
  }, []);
};
