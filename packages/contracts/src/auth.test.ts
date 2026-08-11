import { describe, expect, it } from 'vitest';

import {
  authSessionResponseSchema,
  problemDetailsSchema,
  roleSchema,
  safeUserSchema,
  signinSchema,
  signupSchema,
  userStatusSchema,
} from './index.js';

describe('signupSchema', () => {
  const valid = { email: 'Ada@Example.com', name: 'Ada', password: 'Secure1!' };

  it('trims identity fields without changing the password', () => {
    expect(
      signupSchema.parse({
        ...valid,
        email: ' Ada@Example.com ',
        name: ' Ada ',
      }),
    ).toEqual(valid);
  });

  it.each([
    ['short', 'Aa1!'],
    ['letter', '1234567!'],
    ['number', 'Password!'],
    ['special', 'Password1'],
  ])('rejects a password missing %s', (_rule, password) => {
    expect(signupSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it.each([
    ['role', 'ADMIN'],
    ['status', 'DISABLED'],
    ['id', 'user-123'],
    ['version', 1],
    ['createdAt', '2026-08-11T00:00:00.000Z'],
    ['updatedAt', '2026-08-11T00:00:00.000Z'],
  ])('rejects client-controlled %s', (field, value) => {
    expect(signupSchema.safeParse({ ...valid, [field]: value }).success).toBe(
      false,
    );
  });
});

describe('signinSchema', () => {
  it('trims email without changing the password', () => {
    expect(
      signinSchema.parse({
        email: ' Ada@Example.com ',
        password: ' raw password ',
      }),
    ).toEqual({
      email: 'Ada@Example.com',
      password: ' raw password ',
    });
  });

  it('rejects unexpected request fields', () => {
    expect(
      signinSchema.safeParse({
        email: 'ada@example.com',
        password: 'Secure1!',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
  });
});

describe('safe user and session response schemas', () => {
  const safeUser = {
    id: 'user-123',
    email: 'Ada@Example.com',
    name: 'Ada',
    role: 'USER',
    status: 'ACTIVE',
    version: 0,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  it.each(['USER', 'SUPPORT', 'MANAGER', 'ADMIN'])(
    'accepts the supported %s role',
    (role) => {
      expect(roleSchema.safeParse(role).success).toBe(true);
    },
  );

  it.each(['ACTIVE', 'DISABLED'])(
    'accepts the supported %s user status',
    (status) => {
      expect(userStatusSchema.safeParse(status).success).toBe(true);
    },
  );

  it('rejects unknown roles and user statuses', () => {
    expect(roleSchema.safeParse('OWNER').success).toBe(false);
    expect(userStatusSchema.safeParse('PENDING').success).toBe(false);
  });

  it('rejects unsafe fields from a safe user response', () => {
    expect(
      safeUserSchema.safeParse({ ...safeUser, passwordHash: 'secret' }).success,
    ).toBe(false);
  });

  it('requires a full safe user and a 32-character CSRF token for session responses', () => {
    expect(
      authSessionResponseSchema.parse({
        user: safeUser,
        csrfToken: 'a'.repeat(32),
        features: { assistant: false },
      }),
    ).toMatchObject({ user: safeUser, features: { assistant: false } });
    expect(
      authSessionResponseSchema.safeParse({
        user: safeUser,
        csrfToken: 'too-short',
        features: { assistant: false },
      }).success,
    ).toBe(false);
  });
});

describe('problemDetailsSchema', () => {
  it('accepts stable codes, request IDs, and optional field errors', () => {
    expect(
      problemDetailsSchema.parse({
        type: 'https://easygenerator.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: 'Correct the highlighted fields.',
        code: 'VALIDATION_ERROR',
        requestId: 'req-123',
        fields: [{ field: 'email', message: 'Enter a valid email address.' }],
      }),
    ).toMatchObject({ code: 'VALIDATION_ERROR', requestId: 'req-123' });
  });

  it('rejects malformed field errors and unexpected properties', () => {
    expect(
      problemDetailsSchema.safeParse({
        type: 'https://easygenerator.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_ERROR',
        requestId: 'req-123',
        fields: [{ field: 'email' }],
      }).success,
    ).toBe(false);
    expect(
      problemDetailsSchema.safeParse({
        type: 'https://easygenerator.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_ERROR',
        requestId: 'req-123',
        stack: 'must not leak',
      }).success,
    ).toBe(false);
  });
});
