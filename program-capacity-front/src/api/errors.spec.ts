import axios from 'axios';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/test/server';
import { ApiError, normalizeApiError } from './errors';

const SERVER_ERROR_MESSAGE = 'Something went wrong on the server. Try again shortly.';
const CONNECTION_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';

/** What axios really rejects with when the server answers like `respond`. */
const failureOf = async (respond: () => Response) => {
  server.use(http.get('*/boom', respond));
  return axios.get('/boom').then(
    () => {
      throw new Error('Expected the request to fail');
    },
    (error: unknown) => error,
  );
};

describe('ApiError', () => {
  it('is an Error carrying what a caller branches on and what it shows', () => {
    const error = new ApiError({
      message: 'Program not found',
      status: 404,
      code: 'PROGRAM_NOT_FOUND',
      details: { programId: 'program-1' },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Program not found');
    expect(error.status).toBe(404);
    expect(error.code).toBe('PROGRAM_NOT_FOUND');
    expect(error.details).toEqual({ programId: 'program-1' });
  });
});

describe('normalizeApiError', () => {
  it('returns an ApiError untouched', () => {
    const error = new ApiError({ message: 'Nope', status: 409, code: 'X', details: null });

    expect(normalizeApiError(error)).toBe(error);
  });

  describe('when the server answered with a client error', () => {
    it('keeps the status, the code, the message and the details the server gave', async () => {
      const failure = await failureOf(() =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'INSUFFICIENT_CAPACITY',
            message: 'Program has insufficient available capacity',
            details: { requested: '500.00', available: '100.00', currency: 'USD' },
          },
          { status: 409 },
        ),
      );

      const error = normalizeApiError(failure);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 409,
        code: 'INSUFFICIENT_CAPACITY',
        message: 'Program has insufficient available capacity',
        details: { requested: '500.00', available: '100.00', currency: 'USD' },
      });
    });

    it('carries the per-field errors a validation failure lists', async () => {
      const fields = [{ field: 'amount', errors: ['must be positive'] }];
      const failure = await failureOf(() =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            details: { fields },
          },
          { status: 400 },
        ),
      );

      expect(normalizeApiError(failure).details?.fields).toEqual(fields);
    });

    it('has no code and no details when the server sent a message only', async () => {
      const failure = await failureOf(() =>
        HttpResponse.json({ message: 'Slow down' }, { status: 429 }),
      );

      expect(normalizeApiError(failure)).toMatchObject({
        status: 429,
        message: 'Slow down',
        code: null,
        details: null,
      });
    });

    it.each([
      ['an empty body', () => new HttpResponse(null, { status: 403 }), 403],
      ['a plain text body', () => HttpResponse.text('Forbidden', { status: 403 }), 403],
      ['a body without a message', () => HttpResponse.json({}, { status: 422 }), 422],
    ])('falls back to a generic message for %s', async (_description, respond, status) => {
      const error = normalizeApiError(await failureOf(respond));

      expect(error).toMatchObject({
        status,
        message: 'The request failed.',
        code: null,
        details: null,
      });
    });
  });

  describe('when the server failed', () => {
    it('hides what the server said behind a generic message, keeping status and code', async () => {
      const failure = await failureOf(() =>
        HttpResponse.json(
          {
            statusCode: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'relation "x" does not exist',
          },
          { status: 500 },
        ),
      );

      expect(normalizeApiError(failure)).toMatchObject({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: SERVER_ERROR_MESSAGE,
      });
    });

    it.each([
      ['a gateway page', () => HttpResponse.text('<html>Bad Gateway</html>', { status: 502 }), 502],
      ['no body', () => new HttpResponse(null, { status: 500 }), 500],
      [
        'an unrelated code',
        () => HttpResponse.json({ code: 'OOPS', message: 'x' }, { status: 503 }),
        503,
      ],
    ])('is as vague for %s', async (_description, respond, status) => {
      const error = normalizeApiError(await failureOf(respond));

      expect(error.status).toBe(status);
      expect(error.message).toBe(SERVER_ERROR_MESSAGE);
    });

    it('still says why an FX rate cannot be used, because the user can act on it', async () => {
      const failure = await failureOf(() =>
        HttpResponse.json(
          {
            statusCode: 503,
            code: 'FX_RATE_STALE',
            message: 'The FX rate for this currency pair is too old to reserve against',
            details: { baseCurrency: 'EUR', quoteCurrency: 'USD' },
          },
          { status: 503 },
        ),
      );

      expect(normalizeApiError(failure)).toMatchObject({
        status: 503,
        code: 'FX_RATE_STALE',
        message: 'The FX rate for this currency pair is too old to reserve against',
        details: { baseCurrency: 'EUR', quoteCurrency: 'USD' },
      });
    });

    it('still says when the program is busy, because retrying shortly is the answer', async () => {
      const failure = await failureOf(() =>
        HttpResponse.json(
          { statusCode: 503, code: 'PROGRAM_BUSY', message: 'The program is busy, retry shortly' },
          { status: 503 },
        ),
      );

      expect(normalizeApiError(failure)).toMatchObject({
        status: 503,
        code: 'PROGRAM_BUSY',
        message: 'The program is busy, retry shortly',
      });
    });
  });

  describe('when there was no answer', () => {
    it('reports the connection, with status 0 and nothing else to go on', async () => {
      const failure = await failureOf(() => HttpResponse.error());

      expect(normalizeApiError(failure)).toMatchObject({
        status: 0,
        message: CONNECTION_ERROR_MESSAGE,
        code: null,
        details: null,
      });
    });

    it('does the same for anything that is not an HTTP failure', () => {
      for (const failure of [
        new Error('boom'),
        new TypeError('x is not a function'),
        'boom',
        undefined,
        null,
      ]) {
        expect(normalizeApiError(failure)).toMatchObject({
          status: 0,
          message: CONNECTION_ERROR_MESSAGE,
          code: null,
          details: null,
        });
      }
    });
  });
});
