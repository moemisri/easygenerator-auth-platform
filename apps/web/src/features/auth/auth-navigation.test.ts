import { describe, expect, it } from 'vitest';

import { requestedPath } from './auth-navigation';

describe('requestedPath', () => {
  it('preserves an internal path, query, and fragment', () => {
    expect(
      requestedPath({
        from: {
          pathname: '/assistant',
          search: '?topic=sessions',
          hash: '#sources',
        },
      }),
    ).toBe('/assistant?topic=sessions#sources');
  });

  it.each([
    { from: { pathname: '//attacker.example/steal' } },
    { from: { pathname: 'https://attacker.example/steal' } },
    { from: { pathname: '/signin' } },
    { from: { pathname: '/signup' } },
  ])('falls back for an unsafe or recursive destination', (state) => {
    expect(requestedPath(state)).toBe('/app');
  });

  it('falls back for malformed navigation state', () => {
    expect(requestedPath({ from: null })).toBe('/app');
  });
});
