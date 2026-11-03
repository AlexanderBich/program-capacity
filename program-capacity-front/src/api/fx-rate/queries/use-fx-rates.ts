import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { fxRateKeys } from '../keys';
import { fxRateRoutes } from '../routes';
import type { FxRate } from '../types';

const fetchFxRates = () => api.get<FxRate[]>(fxRateRoutes.all()).then(({ data }) => data);

export const useFxRates = (options: { refetchIntervalMs: number }) =>
  useQuery({
    queryKey: fxRateKeys.list.queryKey,
    queryFn: fetchFxRates,
    refetchInterval: options.refetchIntervalMs,
  });
