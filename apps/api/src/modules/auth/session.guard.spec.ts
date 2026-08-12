import { type ExecutionContext, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { CookieService } from './cookie.service';
import { SessionGuard } from './session.guard';
import type { SessionService } from './session.service';

function contextFor(requestId = '123e4567-e89b-42d3-a456-426614174000') {
  const request = {
    cookies: { session: 'raw-session-token' },
    headers: {},
    id: requestId,
    ip: '203.0.113.9',
    method: 'GET',
  };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

function rejectedGuard(auditRecord = vi.fn().mockResolvedValue(undefined)) {
  const cookies = { read: vi.fn(() => 'raw-session-token') };
  const sessions = {
    resolve: vi.fn().mockResolvedValue(null),
    resolveDetailed: vi.fn().mockResolvedValue({
      principal: null,
      rejection: { actorId: 'known-user-id', reason: 'REVOKED' },
    }),
  };
  const logError = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const guard = new SessionGuard(
    cookies as unknown as CookieService,
    sessions as unknown as SessionService,
    { record: auditRecord } as unknown as AuditService,
  );
  return { auditRecord, guard, logError, sessions };
}

describe('SessionGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits an allowlisted rejected-session event with a known actor', async () => {
    const { auditRecord, guard, sessions } = rejectedGuard();
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    expect(sessions.resolveDetailed).toHaveBeenCalledWith('raw-session-token');
    expect(auditRecord).toHaveBeenCalledWith({
      action: 'SESSION_REJECTED',
      actorId: 'known-user-id',
      reason: 'REVOKED',
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    });
  });

  it('preserves the required 401 and logs only stable context when audit persistence fails', async () => {
    const auditFailure = new Error(
      'mongodb://admin:secret@database.example/raw-session-token',
    );
    const { guard, logError } = rejectedGuard(
      vi.fn().mockRejectedValue(auditFailure),
    );
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(logError).toHaveBeenCalledWith(
      {
        code: 'SESSION_REJECTION_AUDIT_FAILED',
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      },
      'Failed to record rejected session audit',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(
      /secret|raw-session-token|mongodb/u,
    );
  });
});
