import { describe, expect, it } from 'vitest';

import {
  parseSmokeOrigin,
  runSmoke,
} from '../../../../scripts/post-deploy-smoke.mjs';

describe('post-deploy smoke', () => {
  it.each([
    undefined,
    '',
    'localhost:3000',
    'http://user@example.test',
    'https://example.test/path',
    'https://example.test?query=1',
    'https://example.test#fragment',
  ])('rejects unsafe origin %s', (origin) => {
    expect(() => parseSmokeOrigin(origin)).toThrow('INVALID_ORIGIN');
  });

  it('accepts an absolute HTTP or HTTPS origin without credentials or suffixes', () => {
    expect(parseSmokeOrigin('https://example.test').origin).toBe(
      'https://example.test',
    );
    expect(parseSmokeOrigin('http://localhost:3000/').origin).toBe(
      'http://localhost:3000',
    );
  });

  it('checks the front door, health endpoints, and protected denial', async () => {
    const calls = [];
    const responses = new Map([
      [
        '/',
        response(
          200,
          '<!doctype html><title>EasyGenerator</title>',
          'text/html',
        ),
      ],
      ['/health/live', response(200, '{"status":"ok"}', 'application/json')],
      ['/health/ready', response(200, '{"status":"ok"}', 'application/json')],
      [
        '/api/v1/users/me',
        response(401, '{"code":"UNAUTHENTICATED"}', 'application/problem+json'),
      ],
    ]);

    await expect(
      runSmoke('https://example.test', async (url) => {
        calls.push(new URL(url).pathname);
        return responses.get(new URL(url).pathname);
      }),
    ).resolves.toEqual([
      { path: '/', status: 200 },
      { path: '/health/live', status: 200 },
      { path: '/health/ready', status: 200 },
      { path: '/api/v1/users/me', status: 401 },
    ]);
    expect(calls).toEqual([
      '/',
      '/health/live',
      '/health/ready',
      '/api/v1/users/me',
    ]);
  });

  it.each([
    ['/', response(200, '{"ok":true}', 'application/json'), 'INVALID_CONTENT'],
    ['/health/live', response(503, 'down'), 'UNEXPECTED_STATUS'],
    ['/health/ready', response(503, 'down'), 'UNEXPECTED_STATUS'],
    ['/api/v1/users/me', response(200, '{}'), 'UNEXPECTED_STATUS'],
  ])('fails %s with stable category %s', async (path, failed, category) => {
    const fetcher = async (url) => {
      const currentPath = new URL(url).pathname;
      if (currentPath === path) return failed;
      if (currentPath === '/')
        return response(200, '<!doctype html>', 'text/html');
      if (currentPath === '/api/v1/users/me') return response(401, '{}');
      return response(200, '{"status":"ok"}');
    };

    await expect(runSmoke('https://example.test', fetcher)).rejects.toThrow(
      `${path} ${failed.status} ${category}`,
    );
  });

  it.each([
    [
      'body',
      response(200, ['AIzaSyA012345678901', '2345678901234567890'].join('')),
    ],
    [
      'header',
      response(200, '<!doctype html>', 'text/html', {
        'x-debug': ['mongodb://user', ':password@', 'example.test/db'].join(''),
      }),
    ],
  ])(
    'rejects secret-shaped material in a response %s without echoing it',
    async (_surface, tainted) => {
      const fetcher = async (url) => {
        const path = new URL(url).pathname;
        if (path === '/') return tainted;
        if (path === '/api/v1/users/me') return response(401, '{}');
        return response(200, '{"status":"ok"}');
      };

      let message = '';
      try {
        await runSmoke('https://example.test', fetcher);
      } catch (error) {
        message = error.message;
      }
      expect(message).toBe('/ 200 SENSITIVE_MATERIAL');
      expect(message).not.toContain('AIzaSy');
      expect(message).not.toContain('password');
    },
  );

  it('rejects an exact configured secret echo without including the value', async () => {
    const marker = 'short-private-value';
    const fetcher = async (url) =>
      new URL(url).pathname === '/'
        ? response(200, `<!doctype html>${marker}`, 'text/html')
        : response(
            new URL(url).pathname === '/api/v1/users/me' ? 401 : 200,
            '{}',
          );

    await expect(
      runSmoke('https://example.test', fetcher, { GEMINI_API_KEY: marker }),
    ).rejects.toThrow('/ 200 SENSITIVE_MATERIAL');
  });

  it('maps body-read failures to a safe stable category', async () => {
    const responseWithUnsafeFailure = response(
      200,
      '<!doctype html>',
      'text/html',
    );
    responseWithUnsafeFailure.text = async () => {
      throw new Error('secret-marker-from-body-reader');
    };

    let message = '';
    try {
      await runSmoke(
        'https://example.test',
        async () => responseWithUnsafeFailure,
      );
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe('/ 200 RESPONSE_READ_FAILED');
    expect(message).not.toContain('secret-marker');
  });
});

function response(
  status,
  body,
  contentType = 'application/json',
  headers = {},
) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, ...headers },
  });
}
