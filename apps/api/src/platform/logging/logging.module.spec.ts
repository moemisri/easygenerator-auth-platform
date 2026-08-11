import type { DestinationStream } from 'pino';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createPinoHttpOptions, redact } from './logging.module';

describe('createPinoHttpOptions', () => {
  it('serializes safe request data without the lowercased CSRF header value', () => {
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
        headers: {
          'x-csrf-token': 'csrf-token-must-not-serialize',
          'x-request-id': 'safe-request-id',
        },
      },
    });

    const serialized = lines.join('');
    expect(serialized).toContain('safe-request-id');
    expect(serialized).not.toContain('csrf-token-must-not-serialize');
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
