import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError } from '../../platform/errors/app-error';
import { CookieService } from './cookie.service';
import { CsrfService } from './csrf.service';
import type { AuthenticatedHttpRequest } from './session.guard';

const compatibleFetchModes = new Set(['cors', 'same-origin']);

function singleHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    config: ConfigService,
    private readonly cookies: CookieService,
    private readonly csrf: CsrfService,
  ) {
    this.allowedOrigin = config.getOrThrow<string>('APP_ORIGIN');
  }

  private readonly allowedOrigin: string;

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>();
    const origin = singleHeader(request.headers, 'origin');
    const fetchSite = singleHeader(request.headers, 'sec-fetch-site');
    const fetchMode = singleHeader(request.headers, 'sec-fetch-mode');
    const fetchDestination = singleHeader(request.headers, 'sec-fetch-dest');
    const csrfToken = singleHeader(request.headers, 'x-csrf-token');
    const rawSessionToken = this.cookies.read(request.cookies);

    const fetchMetadataIsCompatible =
      (fetchSite === undefined || fetchSite === 'same-origin') &&
      (fetchMode === undefined || compatibleFetchModes.has(fetchMode)) &&
      (fetchDestination === undefined || fetchDestination === 'empty');
    if (
      origin !== this.allowedOrigin ||
      !fetchMetadataIsCompatible ||
      rawSessionToken === null ||
      csrfToken === undefined ||
      !this.csrf.verify(rawSessionToken, csrfToken)
    ) {
      throw new AppError('CSRF_VALIDATION_FAILED', 403);
    }

    request.rawSessionToken = rawSessionToken;
    return true;
  }
}
