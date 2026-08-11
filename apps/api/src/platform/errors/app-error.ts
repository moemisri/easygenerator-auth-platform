import type { FieldError } from '@easygenerator/contracts';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail?: string,
    public readonly fields?: FieldError[],
  ) {
    super(code);
    this.name = 'AppError';
  }
}
