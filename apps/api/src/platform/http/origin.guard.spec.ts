import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { OriginGuard } from './origin.guard';

function contextFor(method: string, origin?: string): ExecutionContext {
  const request = {
    method,
    headers: origin === undefined ? {} : { origin },
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('OriginGuard', () => {
  const guard = new OriginGuard('https://auth.example.com');

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows safe %s requests without an Origin header',
    (method) => {
      expect(guard.canActivate(contextFor(method))).toBe(true);
    },
  );

  it('allows an unsafe request from the configured origin', () => {
    expect(
      guard.canActivate(contextFor('POST', 'https://auth.example.com')),
    ).toBe(true);
  });

  it('rejects an unsafe request without an Origin header', () => {
    expect(() => guard.canActivate(contextFor('POST'))).toThrow(
      ForbiddenException,
    );
  });

  it.each([
    'https://auth.example.com.attacker.example',
    'https://AUTH.example.com.evil',
    'null',
  ])('rejects an unsafe request from %s', (origin) => {
    expect(() => guard.canActivate(contextFor('DELETE', origin))).toThrow(
      ForbiddenException,
    );
  });
});
