import { AppError } from '../../platform/errors/app-error';

export function assistantProtectionUnavailable(): AppError {
  return new AppError('ASSISTANT_PROTECTION_UNAVAILABLE', 503);
}

export class AssistantRateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 429);
  }
}

export class AssistantStreamInProgressError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('ASSISTANT_STREAM_IN_PROGRESS', 429);
  }
}
