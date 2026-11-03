import axios from 'axios';

type FieldError = { field: string; errors: string[] };

type BackendErrorBody = {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: Record<string, unknown> & { fields?: FieldError[] };
};

/** Normalized API failure. Branch on `code`, show `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: BackendErrorBody['details'] | null;

  constructor(params: {
    message: string;
    status: number;
    code: string | null;
    details: BackendErrorBody['details'] | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

export const normalizeApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError<BackendErrorBody>(error) && error.response) {
    const body = error.response.data;
    return new ApiError({
      message:
        error.response.status >= 500 &&
        !body?.code?.startsWith('FX_') &&
        body?.code !== 'PROGRAM_BUSY'
          ? 'Something went wrong on the server. Try again shortly.'
          : (body?.message ?? 'The request failed.'),
      status: error.response.status,
      code: body?.code ?? null,
      details: body?.details ?? null,
    });
  }

  return new ApiError({
    message: 'Could not reach the server. Check your connection and try again.',
    status: 0,
    code: null,
    details: null,
  });
};
