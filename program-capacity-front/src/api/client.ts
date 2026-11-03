import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '@/env';
import { normalizeApiError } from '@/api/errors';
import { getAccessToken, refreshSession } from '@/api/session';

type RetriableRequestConfig = InternalAxiosRequestConfig & { isRetryAfterRefresh?: boolean };

export const api = axios.create({
  baseURL: env.VITE_API_URL,
  timeout: 15_000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetriableRequestConfig | undefined;
    // A 401 from the auth endpoints means wrong credentials, not an expired access token.
    const isRecoverable =
      error.response?.status === 401 &&
      request !== undefined &&
      !request.isRetryAfterRefresh &&
      !request.url?.startsWith('/auth/');
    if (!isRecoverable) throw normalizeApiError(error);

    request.isRetryAfterRefresh = true;
    const { accessToken } = await refreshSession();
    request.headers.Authorization = `Bearer ${accessToken}`;
    return api(request);
  },
);
