import { problemDetailsSchema } from '@easygenerator/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from './app-error';
import { mapProblem } from './problem-details.filter';

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
      'Mongo authentication failed for mongodb://admin:secret@db.example',
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
});
