import { describe, expect, it } from 'vitest';

import { createPinoHttpOptions, redact } from './logging.module';

describe('createPinoHttpOptions', () => {
  it('redacts credentials, cookies, tokens, and service secrets', () => {
    expect(redact).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.csrfToken',
        'res.headers.set-cookie',
        '*.MONGODB_URI',
        '*.REDIS_URL',
        '*.GEMINI_API_KEY',
      ]),
    );
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
