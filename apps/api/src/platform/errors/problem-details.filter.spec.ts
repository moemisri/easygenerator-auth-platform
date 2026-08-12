import { problemDetailsSchema } from '@easygenerator/contracts';
import {
  type ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from './app-error';
import { RateLimitExceededError } from '../redis/rate-limit-exceeded.error';
import {
  mapProblem,
  ProblemDetailsFilter,
  type ProblemLogger,
} from './problem-details.filter';

describe('mapProblem', () => {
  it('maps an AppError without leaking its stack', () => {
    const body = mapProblem(
      new AppError('INVALID_CREDENTIALS', 401),
      'req-123',
    );

    expect(body).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      requestId: 'req-123',
    });
    expect(body).not.toHaveProperty('stack');
    expect(problemDetailsSchema.safeParse(body).success).toBe(true);
  });

  it('preserves safe AppError details and field errors', () => {
    const body = mapProblem(
      new AppError('VALIDATION_ERROR', 400, 'The request is invalid.', [
        { field: 'email', message: 'Enter a valid email address.' },
      ]),
      'req-fields',
      '/api/v1/auth/register',
    );

    expect(body).toMatchObject({
      detail: 'The request is invalid.',
      instance: '/api/v1/auth/register',
      fields: [{ field: 'email', message: 'Enter a valid email address.' }],
    });
    expect(problemDetailsSchema.safeParse(body).success).toBe(true);
  });

  it('maps unknown failures to a generic problem without secrets', () => {
    const failure = new Error(
      [
        'Mongo authentication failed for mongodb://admin',
        ':secret@',
        'db.example',
      ].join(''),
    );
    failure.stack = 'private stack trace';

    const body = mapProblem(failure, 'req-500');

    expect(body).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: 'req-500',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('private stack trace');
    expect(problemDetailsSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['status below problem range', () => new AppError('INVALID', 399)],
    ['status above problem range', () => new AppError('INVALID', 600)],
    ['non-integer status', () => new AppError('INVALID', 400.5)],
    ['empty code', () => new AppError('', 400)],
    ['unstable lowercase code', () => new AppError('invalid_code', 400)],
    ['unstable punctuated code', () => new AppError('INVALID-CODE', 400)],
    ['blank detail', () => new AppError('INVALID', 400, '   ')],
    ['empty fields', () => new AppError('INVALID', 400, undefined, [])],
    [
      'blank field name',
      () =>
        new AppError('INVALID', 400, undefined, [
          { field: ' ', message: 'Required.' },
        ]),
    ],
    [
      'blank field message',
      () =>
        new AppError('INVALID', 400, undefined, [
          { field: 'email', message: ' ' },
        ]),
    ],
  ])('rejects invalid AppError caller input: %s', (_name, createError) => {
    expect(createError).toThrow();
  });

  it('accepts both AppError status boundaries', () => {
    expect(new AppError('CLIENT_ERROR', 400).status).toBe(400);
    expect(new AppError('SERVER_ERROR', 599).status).toBe(599);
  });

  it.each([
    ['AppError', new AppError('INVALID_CREDENTIALS', 401), 'request-app'],
    ['Nest 4xx', new BadRequestException('unsafe detail'), 'request-nest'],
    [
      'parser 4xx',
      { status: 413, message: 'unsafe parser detail' },
      'request-parser',
    ],
    [
      'Nest 5xx',
      new InternalServerErrorException('unsafe internal detail'),
      'request-nest-500',
    ],
    ['unknown 5xx', new Error('unsafe unknown detail'), 'request-unknown'],
  ])('returns a shared-schema-valid envelope for %s', (_name, error, id) => {
    const body = mapProblem(error, id);

    expect(problemDetailsSchema.parse(body)).toEqual(body);
  });

  it('runtime-rejects an invalid envelope correlation ID', () => {
    expect(() => mapProblem(new AppError('INVALID', 400), '')).toThrow();
  });

  it.each([
    ['unknown error', new Error('redis://admin:secret@cache.example')],
    [
      'AppError 5xx',
      new AppError('DEPENDENCY_FAILURE', 503, 'Dependency unavailable.'),
    ],
    [
      'Nest 5xx',
      new InternalServerErrorException(
        ['mongodb://admin', ':secret@', 'db.example'].join(''),
      ),
    ],
  ])('logs a safe correlated event for %s', (_name, failure) => {
    const events: Array<{ context: object; message: string }> = [];
    const logger: ProblemLogger = {
      error: (context, message) => events.push({ context, message }),
    };
    let responseBody: unknown;
    let responseStatus: number | undefined;
    const response = {
      status: (status: number) => {
        responseStatus = status;
        return {
          json: (body: unknown) => {
            responseBody = body;
          },
        };
      },
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'request-correlated',
          method: 'POST',
          originalUrl: '/api/v1/auth?token=unsafe-query',
          body: { password: 'unsafe-password' },
        }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    new ProblemDetailsFilter(logger).catch(failure, host);

    expect(responseStatus).toBeGreaterThanOrEqual(500);
    expect(responseBody).toMatchObject({ requestId: 'request-correlated' });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toBe('Unexpected request failure');
    expect(events[0]?.context).toMatchObject({
      requestId: 'request-correlated',
    });
    expect(typeof (events[0]?.context as { code?: unknown }).code).toBe(
      'string',
    );
    expect(
      typeof (events[0]?.context as { errorType?: unknown }).errorType,
    ).toBe('string');
    expect(typeof (events[0]?.context as { status?: unknown }).status).toBe(
      'number',
    );
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(JSON.stringify(events)).not.toContain('unsafe');
    expect(JSON.stringify(events)).not.toContain('password');
  });

  it('does not report an expected 4xx problem as an unexpected failure', () => {
    const events: Array<object> = [];
    const logger: ProblemLogger = {
      error: (context) => events.push(context),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ id: 'request-4xx', originalUrl: '/safe' }),
        getResponse: () => ({
          status: () => ({ json: () => undefined }),
        }),
      }),
    } as ArgumentsHost;

    new ProblemDetailsFilter(logger).catch(
      new AppError('INVALID_REQUEST', 400),
      host,
    );

    expect(events).toEqual([]);
  });

  it('ends a flushed error response without rewriting status, headers, or JSON', () => {
    const events: Array<{ context: object; message: string }> = [];
    const end = vi.fn();
    const response = {
      headersSent: true,
      writableEnded: false,
      end,
      setHeader: vi.fn(() => {
        throw new Error('headers must not be rewritten');
      }),
      status: vi.fn(() => {
        throw new Error('status must not be rewritten');
      }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'request-flushed',
          originalUrl: '/api/v1/assistant/chat',
        }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    expect(() =>
      new ProblemDetailsFilter({
        error: (context, message) => events.push({ context, message }),
      }).catch(new Error('socket write failed with secret'), host),
    ).not.toThrow();

    expect(end).toHaveBeenCalledOnce();
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        context: {
          code: 'INTERNAL_ERROR',
          errorType: 'Error',
          requestId: 'request-flushed',
          status: 500,
        },
        message: 'Unexpected request failure',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('sets Retry-After for a blocked fixed window', () => {
    let retryAfter: string | undefined;
    const response = {
      setHeader: (name: string, value: string) => {
        if (name === 'Retry-After') retryAfter = value;
      },
      status: () => ({ json: () => undefined }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ id: 'request-rate-limit', originalUrl: '/auth' }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    new ProblemDetailsFilter({ error: () => undefined }).catch(
      new RateLimitExceededError(83),
      host,
    );

    expect(retryAfter).toBe('83');
  });

  it.each([
    '/API/V1/ADMIN/users?page=1',
    '/Api/v1/AdMiN/users/507f1f77bcf86cd799439011',
  ])(
    'sets no-store on every case spelling of an admin error response',
    (url) => {
      let cacheControl: string | undefined;
      const response = {
        setHeader: (name: string, value: string) => {
          if (name === 'Cache-Control') cacheControl = value;
        },
        status: () => ({ json: () => undefined }),
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({
            id: 'request-admin',
            originalUrl: url,
          }),
          getResponse: () => response,
        }),
      } as ArgumentsHost;

      new ProblemDetailsFilter({ error: () => undefined }).catch(
        new AppError('INSUFFICIENT_CAPABILITY', 403),
        host,
      );

      expect(cacheControl).toBe('no-store');
    },
  );

  it('uses the exact admin path as instance without exposing query data', () => {
    let cacheControl: string | undefined;
    let responseBody: unknown;
    const response = {
      setHeader: (name: string, value: string) => {
        if (name === 'Cache-Control') cacheControl = value;
      },
      status: () => ({
        json: (body: unknown) => {
          responseBody = body;
        },
      }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'request-admin-instance',
          originalUrl:
            '/api/v1/admin/users/507f1f77bcf86cd799439011?email=problem-instance-sentinel&token=problem-token-sentinel',
        }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    new ProblemDetailsFilter({ error: () => undefined }).catch(
      new AppError('INSUFFICIENT_CAPABILITY', 403),
      host,
    );

    expect(responseBody).toMatchObject({
      instance: '/api/v1/admin/users/507f1f77bcf86cd799439011',
    });
    expect(JSON.stringify(responseBody)).not.toMatch(
      /problem-instance-sentinel|problem-token-sentinel/u,
    );
    expect(cacheControl).toBe('no-store');
  });

  it('sets no-store on assistant errors before SSE starts', () => {
    let cacheControl: string | undefined;
    const response = {
      setHeader: (name: string, value: string) => {
        if (name === 'Cache-Control') cacheControl = value;
      },
      status: () => ({ json: () => undefined }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'request-assistant',
          originalUrl: '/API/V1/ASSISTANT/chat?unsafe=query',
        }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    new ProblemDetailsFilter({ error: () => undefined }).catch(
      new AppError('ASSISTANT_DISABLED', 404),
      host,
    );

    expect(cacheControl).toBe('no-store');
  });
});
