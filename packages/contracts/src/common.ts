import { z } from 'zod';

export const fieldErrorSchema = z
  .object({
    field: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const problemDetailsSchema = z
  .object({
    type: z.string().url(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1).optional(),
    instance: z.string().min(1).optional(),
    code: z.string().min(1),
    requestId: z.string().min(1),
    fields: z.array(fieldErrorSchema).optional(),
  })
  .strict();

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
