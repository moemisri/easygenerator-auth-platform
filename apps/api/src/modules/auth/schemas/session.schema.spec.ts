import { describe, expect, it } from 'vitest';

import { SessionSchema } from './session.schema';

describe('SessionSchema', () => {
  it('uniquely indexes token digests and expires records by absolute date', () => {
    expect(SessionSchema.indexes()).toContainEqual([
      { tokenDigest: 1 },
      { unique: true },
    ]);
    expect(SessionSchema.indexes()).toContainEqual([
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ]);
  });

  it('has no field capable of persisting a raw session token', () => {
    expect(SessionSchema.path('rawToken')).toBeUndefined();
    expect(SessionSchema.path('token')).toBeUndefined();
  });
});
