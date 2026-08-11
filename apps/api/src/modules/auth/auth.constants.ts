import { AppError } from '../../platform/errors/app-error';

export const IDENTITY_HASH_SECRET = Symbol('IDENTITY_HASH_SECRET');
export const DUMMY_PASSWORD_HASH = Symbol('DUMMY_PASSWORD_HASH');

export const SIGNUP_IP_LIMIT = 5;
export const SIGNUP_WINDOW_SECONDS = 60 * 60;
export const SIGNIN_IP_LIMIT = 10;
export const SIGNIN_IDENTITY_LIMIT = 5;
export const SIGNIN_WINDOW_SECONDS = 15 * 60;

export class RateLimitExceededError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 429);
  }
}
