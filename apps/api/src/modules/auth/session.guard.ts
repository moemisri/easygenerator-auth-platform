import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { AppError } from '../../platform/errors/app-error.js';
import { CookieService } from './cookie.service.js';
import {
  type AuthenticatedPrincipal,
  SessionService,
} from './session.service.js';

export interface AuthenticatedHttpRequest {
  cookies?: Record<string, string | undefined>;
  headers: Record<string, string | string[] | undefined>;
  id: string;
  ip: string;
  method: string;
  principal?: AuthenticatedPrincipal;
  rawSessionToken?: string;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>();
    const rawSessionToken = this.cookies.read(request.cookies);
    if (rawSessionToken === null) {
      throw new AppError('UNAUTHENTICATED', 401);
    }

    const principal = await this.sessions.resolve(rawSessionToken);
    if (principal === null) {
      throw new AppError('UNAUTHENTICATED', 401);
    }

    request.principal = principal;
    request.rawSessionToken = rawSessionToken;
    return true;
  }
}
