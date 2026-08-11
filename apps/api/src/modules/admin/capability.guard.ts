import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../../platform/errors/app-error';
import type { AuthenticatedHttpRequest } from '../auth/session.guard';
import { can, type Capability } from './authorization.policy';
import { REQUIRED_CAPABILITY } from './capability.decorator';

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>();
    if (request.principal === undefined) {
      throw new AppError('UNAUTHENTICATED', 401);
    }

    const required = this.reflector.getAllAndOverride<Capability>(
      REQUIRED_CAPABILITY,
      [context.getHandler(), context.getClass()],
    );
    if (!can(request.principal.user.role, required)) {
      throw new AppError('INSUFFICIENT_CAPABILITY', 403);
    }
    return true;
  }
}
