import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { CookieService } from './cookie.service';

function configFor({
  cookieSecure,
  nodeEnvironment,
  sessionTtlSeconds = 7 * 24 * 60 * 60,
}: {
  cookieSecure: boolean;
  nodeEnvironment: 'development' | 'production';
  sessionTtlSeconds?: number;
}) {
  return {
    getOrThrow: (key: string) => {
      if (key === 'NODE_ENV') return nodeEnvironment;
      if (key === 'COOKIE_SECURE') return cookieSecure;
      if (key === 'SESSION_TTL_SECONDS') return sessionTtlSeconds;
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

describe('CookieService', () => {
  it('sets the exact production __Host cookie attributes without Domain', () => {
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new CookieService(
      configFor({ cookieSecure: true, nodeEnvironment: 'production' }),
    );

    service.set(response, 'raw-token');

    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-session',
      'raw-token',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    );
    expect(response.cookie.mock.calls[0]?.[2]).not.toHaveProperty('domain');
  });

  it('uses a distinct non-Secure development cookie when configured', () => {
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new CookieService(
      configFor({ cookieSecure: false, nodeEnvironment: 'development' }),
    );

    service.set(response, 'raw-token');

    expect(response.cookie).toHaveBeenCalledWith(
      'session',
      'raw-token',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
      }),
    );
  });

  it('uses the validated secure flag, cookie name, and session lifetime', () => {
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new CookieService(
      configFor({
        cookieSecure: true,
        nodeEnvironment: 'development',
        sessionTtlSeconds: 123,
      }),
    );

    service.set(response, 'raw-token');

    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-session',
      'raw-token',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 123_000,
      },
    );
  });

  it('clears with attributes matching the cookie scope and security flags', () => {
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new CookieService(
      configFor({ cookieSecure: true, nodeEnvironment: 'production' }),
    );

    service.clear(response);

    expect(response.clearCookie).toHaveBeenCalledWith('__Host-session', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});
