import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { AppError } from '../../platform/errors/app-error.js';
import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service.js';
import { RateLimitExceededError } from '../../platform/redis/rate-limit-exceeded.error.js';
import {
  type RateLimitDecision,
  RateLimiterService,
} from '../../platform/redis/rate-limiter.service.js';
import type { AuthenticatedHttpRequest } from '../auth/session.guard.js';

const ADMIN_MUTATION_LIMIT = 20;
const ADMIN_MUTATION_WINDOW_SECONDS = 60;

@Injectable()
export class AdminMutationProtectionGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly privacyKeys: PrivacyKeyDigestService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedHttpRequest>();
    if (request.principal === undefined) {
      throw new AppError('UNAUTHENTICATED', 401);
    }

    let decisions: RateLimitDecision[];
    try {
      const actorDigest = this.privacyKeys.digest(
        'admin-mutation:actor',
        request.principal.user.id,
      );
      const ipDigest = this.privacyKeys.digest('admin-mutation:ip', request.ip);
      decisions = await Promise.all([
        this.rateLimiter.consume(
          `admin-mutation:actor:${actorDigest}`,
          ADMIN_MUTATION_LIMIT,
          ADMIN_MUTATION_WINDOW_SECONDS,
        ),
        this.rateLimiter.consume(
          `admin-mutation:ip:${ipDigest}`,
          ADMIN_MUTATION_LIMIT,
          ADMIN_MUTATION_WINDOW_SECONDS,
        ),
      ]);
    } catch {
      throw new AppError('ADMIN_MUTATION_PROTECTION_UNAVAILABLE', 503);
    }

    const blocked = decisions.filter((decision) => !decision.allowed);
    if (blocked.length > 0) {
      throw new RateLimitExceededError(
        Math.max(...blocked.map((decision) => decision.retryAfterSeconds)),
      );
    }
    return true;
  }
}
