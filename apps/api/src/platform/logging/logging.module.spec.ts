import type { DestinationStream } from 'pino';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { describe, expect, it } from 'vitest';

import { createPinoHttpOptions, redact } from './logging.module';

describe('createPinoHttpOptions', () => {
  it('serializes an exact request allowlist from a raw Express-like request', () => {
    const options = createPinoHttpOptions({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
    const serializer = options.serializers?.req;
    if (serializer === undefined) {
      throw new Error('Expected a request serializer to be configured');
    }

    expect(
      serializer({
        id: 'server-owned-request-id',
        method: 'POST',
        originalUrl:
          '/api/v1/admin/users?email=query-email-sentinel&token=query-token-sentinel',
        url: '/unsafe-url-fallback?token=raw-url-sentinel',
        headers: {
          authorization: 'Bearer authorization-header-sentinel',
          cookie: 'cookie-header-sentinel',
          'x-csrf-token': 'csrf-header-sentinel',
          'x-request-id': 'attacker-request-id-sentinel',
        },
        query: { email: 'query-object-sentinel' },
        body: { password: 'body-password-sentinel' },
        socket: { remoteAddress: 'socket-address-sentinel' },
      } as never),
    ).toEqual({
      id: 'server-owned-request-id',
      method: 'POST',
      path: '/api/v1/admin/users',
    });
  });

  it('keeps query and request metadata out after actual pino-http wrapping', () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
      write: (message) => lines.push(message),
    };
    const options = createPinoHttpOptions({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
    const middleware = pinoHttp(
      { ...options, autoLogging: false },
      destination,
    );
    const request = {
      id: 'server-owned-wrapped-id',
      method: 'PATCH',
      originalUrl:
        '/api/v1/admin/users/wrapped?email=wrapped-email-sentinel&token=wrapped-token-sentinel',
      url: '/raw-url-sentinel?token=raw-url-token-sentinel',
      headers: {
        authorization: 'Bearer wrapped-authorization-sentinel',
        cookie: 'wrapped-cookie-sentinel',
        'x-csrf-token': 'wrapped-csrf-sentinel',
        'x-request-id': 'wrapped-attacker-request-id-sentinel',
      },
      query: { email: 'wrapped-query-object-sentinel' },
      body: { password: 'wrapped-body-sentinel' },
      socket: {
        remoteAddress: 'wrapped-socket-address-sentinel',
        remotePort: 65_535,
      },
    } as never;
    const response = {} as never;

    middleware(request, response);
    (request as { log: { info: (message: string) => void } }).log.info(
      'wrapped serializer proof',
    );

    const logged = JSON.parse(lines.at(-1) ?? '{}') as { req?: unknown };
    expect(logged.req).toEqual({
      id: 'server-owned-wrapped-id',
      method: 'PATCH',
      path: '/api/v1/admin/users/wrapped',
    });
    expect(lines.join('')).not.toMatch(
      /query|token|email|authorization|cookie|csrf|attacker|body|socket|raw-url|65535/u,
    );
  });

  it('redacts assistant message and history content from a realistic request body', () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
      write: (message) => lines.push(message),
    };
    const options = createPinoHttpOptions({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
    if (options.redact === undefined) {
      throw new Error('Expected production log redaction to be configured');
    }
    const logger = pino({ redact: options.redact }, destination);

    logger.info({
      req: {
        id: 'safe-assistant-request-id',
        body: {
          message: 'assistant-message-sentinel',
          history: [{ role: 'user', content: 'assistant-history-sentinel' }],
        },
      },
    });

    const serialized = lines.join('');
    expect(serialized).toContain('safe-assistant-request-id');
    expect(serialized).not.toContain('assistant-message-sentinel');
    expect(serialized).not.toContain('assistant-history-sentinel');
  });

  it('uses validated production log settings without a pretty transport', () => {
    expect(
      createPinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }),
    ).toMatchObject({ level: 'warn', redact });
    expect(
      createPinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }),
    ).not.toHaveProperty('transport');
  });
});
