import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service.js';
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
  private readonly logger = new Logger(SessionGuard.name);

  constructor(
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>();
    const rawSessionToken = this.cookies.read(request.cookies);
    if (rawSessionToken === null) {
      throw new AppError('UNAUTHENTICATED', 401);
    }

    const resolution = await this.sessions.resolveDetailed(rawSessionToken);
    if (resolution.principal === null) {
      if (resolution.rejection !== null) {
        try {
          await this.audit.record({
            action: 'SESSION_REJECTED',
            actorId: resolution.rejection.actorId,
            reason: resolution.rejection.reason,
            requestId: request.id,
          });
        } catch {
          this.logger.error(
            {
              code: 'SESSION_REJECTION_AUDIT_FAILED',
              requestId: request.id,
            },
            'Failed to record rejected session audit',
          );
        }
      }
      throw new AppError('UNAUTHENTICATED', 401);
    }

    request.principal = resolution.principal;
    request.rawSessionToken = rawSessionToken;
    return true;
  }
}
