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
});
