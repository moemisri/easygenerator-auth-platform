import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEvent } from './schemas/audit-event.schema';
import { AuditService, type AuditInput } from './audit.service';

describe('AuditService', () => {
  it.each<{
    input: AuditInput;
    expected: Record<string, unknown>;
  }>([
    {
      input: {
        action: 'ADMIN_BOOTSTRAPPED',
        actorId: 'actor-id',
        requestId: 'bootstrap-cli',
      },
      expected: {
        action: 'ADMIN_BOOTSTRAPPED',
        actorId: 'actor-id',
        requestId: 'bootstrap-cli',
      },
    },
    {
      input: {
        action: 'AUTH_SIGNUP_SUCCEEDED',
        actorId: 'actor-id',
        requestId: 'request-id',
      },
      expected: {
        action: 'AUTH_SIGNUP_SUCCEEDED',
        actorId: 'actor-id',
        requestId: 'request-id',
      },
    },
    {
      input: {
        action: 'AUTH_SIGNIN_FAILED',
        identityDigest: 'identity-digest',
        requestId: 'request-id',
      },
      expected: {
        action: 'AUTH_SIGNIN_FAILED',
        requestId: 'request-id',
        metadata: { identityDigest: 'identity-digest' },
      },
    },
    {
      input: {
        action: 'SESSION_REJECTED',
        actorId: null,
        reason: 'EXPIRED',
        requestId: 'request-id',
      },
      expected: {
        action: 'SESSION_REJECTED',
        actorId: null,
        requestId: 'request-id',
        metadata: { reason: 'EXPIRED' },
      },
    },
    {
      input: {
        action: 'USER_ROLE_CHANGED',
        actorId: 'actor-id',
        targetId: 'target-id',
        from: 'USER',
        to: 'SUPPORT',
        requestId: 'request-id',
      },
      expected: {
        action: 'USER_ROLE_CHANGED',
        actorId: 'actor-id',
        targetId: 'target-id',
        requestId: 'request-id',
        metadata: { from: 'USER', to: 'SUPPORT' },
      },
    },
    {
      input: {
        action: 'USER_STATUS_CHANGED',
        actorId: 'actor-id',
        targetId: 'target-id',
        from: 'ACTIVE',
        to: 'DISABLED',
        requestId: 'request-id',
      },
      expected: {
        action: 'USER_STATUS_CHANGED',
        actorId: 'actor-id',
        targetId: 'target-id',
        requestId: 'request-id',
        metadata: { from: 'ACTIVE', to: 'DISABLED' },
      },
    },
    {
      input: {
        action: 'ASSISTANT_REFUSED',
        actorId: 'actor-id',
        reason: 'INSUFFICIENT_DOCUMENTATION',
        requestId: 'request-id',
      },
      expected: {
        action: 'ASSISTANT_REFUSED',
        actorId: 'actor-id',
        requestId: 'request-id',
        metadata: { reason: 'INSUFFICIENT_DOCUMENTATION' },
      },
    },
  ])('allowlists fields for $input.action', async ({ input, expected }) => {
    const create = vi.fn().mockResolvedValue(undefined);
    const service = new AuditService({
      create,
    } as unknown as Model<AuditEvent>);

    await service.record(input);

    expect(create).toHaveBeenCalledWith(expected);
  });

  it('drops arbitrary metadata, secrets, and raw identities at runtime', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const service = new AuditService({
      create,
    } as unknown as Model<AuditEvent>);
    const hostileInput = {
      action: 'AUTH_SIGNIN_FAILED',
      identityDigest: 'identity-digest',
      requestId: 'request-id',
      identity: 'raw@example.com',
      password: 'Secure1!',
      metadata: { secret: 'session-token' },
    } as AuditInput;

    await service.record(hostileInput);

    expect(create).toHaveBeenCalledWith({
      action: 'AUTH_SIGNIN_FAILED',
      requestId: 'request-id',
      metadata: { identityDigest: 'identity-digest' },
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain('raw@example.com');
    expect(JSON.stringify(create.mock.calls)).not.toContain('Secure1!');
    expect(JSON.stringify(create.mock.calls)).not.toContain('session-token');
  });

  it('maps newest-first pages to presentation-safe redacted events', async () => {
    const records = [
      {
        _id: 'event-2',
        action: 'AUTH_SIGNIN_FAILED',
        actorId: null,
        requestId: 'request-secret',
        metadata: {
          identityDigest: 'identity-digest-secret',
          injected: 'raw-json-secret',
        },
        createdAt: new Date('2026-08-02T10:00:00.000Z'),
      },
      {
        _id: 'event-1',
        action: 'USER_ROLE_CHANGED',
        actorId: 'actor-id-secret',
        targetId: 'target-id-secret',
        requestId: 'request-secret-2',
        metadata: { from: 'USER', to: 'SUPPORT', token: 'session-secret' },
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      },
    ];
    const exec = vi.fn().mockResolvedValue(records);
    const lean = vi.fn(() => ({ exec }));
    const limit = vi.fn(() => ({ lean }));
    const skip = vi.fn(() => ({ limit }));
    const sort = vi.fn(() => ({ skip }));
    const select = vi.fn(() => ({ sort }));
    const find = vi.fn(() => ({ select }));
    const countDocuments = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(2),
    }));
    const service = new AuditService({
      countDocuments,
      find,
    } as unknown as Model<AuditEvent>);

    const page = await service.listSafe({ page: 2, pageSize: 2 });

    expect(page).toEqual({
      items: [
        {
          id: 'event-2',
          action: 'AUTH_SIGNIN_FAILED',
          occurredAt: '2026-08-02T10:00:00.000Z',
          summary: 'A sign-in attempt was rejected.',
        },
        {
          id: 'event-1',
          action: 'USER_ROLE_CHANGED',
          occurredAt: '2026-08-01T10:00:00.000Z',
          summary: 'A user role changed from USER to SUPPORT.',
        },
      ],
      page: 2,
      pageSize: 2,
      total: 2,
    });
    expect(select).toHaveBeenCalledWith('_id action metadata createdAt');
    expect(sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(skip).toHaveBeenCalledWith(2);
    expect(limit).toHaveBeenCalledWith(2);
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('identity-digest-secret');
    expect(serialized).not.toContain('raw-json-secret');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('actor-id-secret');
    expect(serialized).not.toContain('target-id-secret');
    expect(serialized).not.toContain('request-secret');
  });

  it('does not reflect malformed metadata in a redacted summary', async () => {
    const exec = vi.fn().mockResolvedValue([
      {
        _id: 'event-id',
        action: 'USER_STATUS_CHANGED',
        metadata: {
          from: '<script>secret</script>',
          to: 'ACTIVE',
        },
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      },
    ]);
    const lean = vi.fn(() => ({ exec }));
    const limit = vi.fn(() => ({ lean }));
    const skip = vi.fn(() => ({ limit }));
    const sort = vi.fn(() => ({ skip }));
    const select = vi.fn(() => ({ sort }));
    const service = new AuditService({
      countDocuments: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(1),
      })),
      find: vi.fn(() => ({ select })),
    } as unknown as Model<AuditEvent>);

    const page = await service.listSafe({ page: 1, pageSize: 20 });

    expect(page.items[0]?.summary).toBe('A user status changed.');
    expect(JSON.stringify(page)).not.toContain('<script>');
  });
});
