import { AppError } from '../errors/app-error.js';

export class RateLimitExceededError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 429);
  }
}
