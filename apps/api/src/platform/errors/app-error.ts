import type { FieldError } from '@easygenerator/contracts';
import { z } from 'zod';

const nonblankText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Value cannot be blank');

const appErrorInputSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*(?![\s\S])/),
    status: z.number().int().min(400).max(599),
    detail: nonblankText.optional(),
    fields: z
      .array(
        z
          .object({
            field: nonblankText,
            message: nonblankText,
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict();

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail: string | undefined;
  public readonly fields: FieldError[] | undefined;

  constructor(
    code: string,
    status: number,
    detail?: string,
    fields?: FieldError[],
  ) {
    const parsed = appErrorInputSchema.parse({
      code,
      status,
      ...(detail === undefined ? {} : { detail }),
      ...(fields === undefined ? {} : { fields }),
    });
    super(parsed.code);
    this.name = 'AppError';
    this.code = parsed.code;
    this.status = parsed.status;
    this.detail = parsed.detail;
    this.fields = parsed.fields;
  }
}
