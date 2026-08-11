import { describe, expect, it } from 'vitest';

import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('creates a server-controlled request ID and returns it to the caller', () => {
    const request: {
      id?: string;
      headers: Record<string, string>;
    } = {
      headers: { 'x-request-id': 'attacker-controlled' },
    };
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    };
    let continued = false;

    new RequestIdMiddleware().use(request, response, () => {
      continued = true;
    });

    expect(request.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(request.id).not.toBe('attacker-controlled');
    expect(headers.get('X-Request-Id')).toBe(request.id);
    expect(continued).toBe(true);
  });
});
