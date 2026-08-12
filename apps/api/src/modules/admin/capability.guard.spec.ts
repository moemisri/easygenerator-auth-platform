import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../platform/errors/app-error';
import { RequireCapability } from './capability.decorator';
import { CapabilityGuard } from './capability.guard';

class ReadUsersController {
  @RequireCapability('READ_USERS')
  list(): void {}

  undecorated(): void {}
}

function controllerHandler(name: 'list' | 'undecorated'): () => void {
  return Reflect.get(ReadUsersController.prototype, name);
}

function contextFor(handler: () => void, role?: unknown): ExecutionContext {
  const request =
    role === undefined
      ? {}
      : {
          principal: {
            sessionId: 'session-id',
            user: { id: 'actor-id', role },
          },
        };
  return {
    getHandler: () => handler,
    getClass: () => ReadUsersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CapabilityGuard', () => {
  const guard = new CapabilityGuard(new Reflector());

  it('allows a current role with the named capability', () => {
    expect(
      guard.canActivate(contextFor(controllerHandler('list'), 'SUPPORT')),
    ).toBe(true);
  });

  it('denies a current role without the named capability', () => {
    expect(() =>
      guard.canActivate(contextFor(controllerHandler('list'), 'USER')),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_CAPABILITY',
        status: 403,
      }) as AppError,
    );
  });

  it('fails closed when capability metadata is missing', () => {
    expect(() =>
      guard.canActivate(contextFor(controllerHandler('undecorated'), 'ADMIN')),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_CAPABILITY',
        status: 403,
      }) as AppError,
    );
  });

  it.each(['OWNER', 'ADMINISTRATOR', '', 4])(
    'fails closed for malformed/future persisted role %j',
    (role) => {
      expect(() =>
        guard.canActivate(contextFor(controllerHandler('list'), role)),
      ).toThrowError(
        expect.objectContaining({
          code: 'INSUFFICIENT_CAPABILITY',
          status: 403,
        }) as AppError,
      );
    },
  );

  it('reports unauthenticated when SessionGuard did not attach a principal', () => {
    expect(() =>
      guard.canActivate(contextFor(controllerHandler('list'))),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNAUTHENTICATED',
        status: 401,
      }) as AppError,
    );
  });
});
