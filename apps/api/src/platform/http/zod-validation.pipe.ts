import type { FieldError } from '@easygenerator/contracts';
import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';

import { AppError } from '../errors/app-error';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType) {}

  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    const metatype = metadata?.metatype as { schema?: ZodType } | undefined;
    const schema = this.schema ?? metatype?.schema;
    if (schema === undefined) return value;

    const result = schema.safeParse(value);
    if (result.success) return result.data;

    const fields: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.length === 0 ? 'request' : issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'The request is invalid.',
      fields,
    );
  }
}
