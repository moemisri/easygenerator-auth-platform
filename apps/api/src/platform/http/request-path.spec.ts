import { describe, expect, it } from 'vitest';

import { requestPath } from './request-path';

describe('requestPath', () => {
  it.each([
    ['/api/v1/admin/users', '/api/v1/admin/users'],
    [
      '/api/v1/admin/users?email=encoded%40email.example#private-fragment',
      '/api/v1/admin/users',
    ],
    [
      '/api/v1/admin/users#private-fragment?token=secret',
      '/api/v1/admin/users',
    ],
    ['?email=query-only-sentinel', undefined],
    ['#fragment-only-sentinel', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('returns only the leading path for %j', (value, expected) => {
    expect(requestPath(value)).toBe(expected);
  });
});
