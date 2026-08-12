import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedPrincipal } from './session.service.js';
import type { AuthenticatedHttpRequest } from './session.guard.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>().principal;
    if (principal === undefined) {
      throw new Error('CurrentPrincipal requires SessionGuard');
    }
    return principal;
  },
);
