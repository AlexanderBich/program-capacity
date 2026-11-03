import { useSessionStore } from '../store';

export const useSession = () => {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);

  return {
    status,
    user,
    canOperate: user?.role === 'ADMIN' || user?.role === 'OPERATOR',
    isAdmin: user?.role === 'ADMIN',
  };
};
