import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ email: z.email() }).strict();

  it('returns parsed and normalized input', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ email: 'person@example.com' })).toEqual({
      email: 'person@example.com',
    });
  });

  it('maps validation failures to field-safe AppErrors', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'not-an-email' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        fields: [{ field: 'email' }],
      });
    }
  });
});
