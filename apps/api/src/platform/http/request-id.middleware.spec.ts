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

  it('propagates a syntactically valid UUID request ID', () => {
    const inbound = '123e4567-e89b-42d3-a456-426614174000';
    const request: {
      headers: Record<string, string>;
      id?: string;
    } = {
      headers: { 'x-request-id': inbound },
    };
    const headers = new Map<string, string>();

    new RequestIdMiddleware().use(
      request,
      { setHeader: (name, value) => headers.set(name, value) },
      () => undefined,
    );

    expect(request.id).toBe(inbound);
    expect(headers.get('X-Request-Id')).toBe(inbound);
  });

  it.each([
    '',
    'attacker-controlled',
    '123e4567-e89b-02d3-a456-426614174000',
    '123e4567-e89b-42d3-c456-426614174000',
    '123e4567-e89b-42d3-a456-426614174000\nforged',
  ])('replaces malformed inbound request ID %j', (inbound) => {
    const request: {
      headers: Record<string, string>;
      id?: string;
    } = {
      headers: { 'x-request-id': inbound },
    };

    new RequestIdMiddleware().use(
      request,
      { setHeader: () => undefined },
      () => undefined,
    );

    expect(request.id).not.toBe(inbound);
    expect(request.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
