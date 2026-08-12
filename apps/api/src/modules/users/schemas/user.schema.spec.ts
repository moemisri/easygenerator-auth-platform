import { describe, expect, it } from 'vitest';

import { UserSchema } from './user.schema';

describe('UserSchema', () => {
  it('uniquely indexes only the normalized email key', () => {
    expect(UserSchema.indexes()).toContainEqual([
      { emailKey: 1 },
      { unique: true },
    ]);
    expect(UserSchema.path('email').options.unique).not.toBe(true);
  });

  it('indexes every allowlisted admin sort with a stable id tiebreaker', () => {
    expect(UserSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ createdAt: 1, _id: 1 }, {}],
        [{ name: 1, _id: 1 }, {}],
        [{ email: 1, _id: 1 }, {}],
        [{ status: 1 }, {}],
      ]),
    );
  });

  it('keeps password hashes out of normal selections', () => {
    expect(UserSchema.path('passwordHash').options.select).toBe(false);
  });

  it('uses secure public defaults and concurrency-safe timestamps', () => {
    expect(UserSchema.path('role').options.default).toBe('USER');
    expect(UserSchema.path('status').options.default).toBe('ACTIVE');
    expect(UserSchema.get('timestamps')).toBe(true);
    expect(UserSchema.get('optimisticConcurrency')).toBe(true);
    expect(UserSchema.get('versionKey')).toBe('version');
  });
});
