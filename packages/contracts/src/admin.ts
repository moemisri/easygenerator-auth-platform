import { z } from 'zod';

import { roleSchema, safeUserSchema, userStatusSchema } from './user.js';

const queryInteger = (minimum: number, maximum?: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : value,
    maximum === undefined
      ? z.number().int().min(minimum)
      : z.number().int().min(minimum).max(maximum),
  );

export const adminUserSortSchema = z.enum(['createdAt', 'name', 'email']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export const adminUserIdParamsSchema = z
  .object({
    id: z
      .string()
      .regex(/^[0-9a-f]{24}$/i, 'Enter a valid 24-character user ID.'),
  })
  .strict();

export const adminUsersQuerySchema = z
  .object({
    page: queryInteger(1, 10_000).default(1),
    pageSize: queryInteger(1, 50).default(20),
    search: z
      .string()
      .trim()
      .max(100)
      .refine((value) => !/\p{Cc}/u.test(value), {
        message: 'Search must not contain control characters.',
      })
      .optional(),
    sort: adminUserSortSchema.default('createdAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .strict();

export const updateAdminUserSchema = z
  .object({
    version: z.number().int().nonnegative(),
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .strict()
  .refine((input) => input.role !== undefined || input.status !== undefined, {
    message: 'At least one role or status change is required.',
  });

export const adminUsersResponseSchema = z
  .object({
    items: z.array(safeUserSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().nonnegative(),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const adminAuditEventsQuerySchema = z
  .object({
    page: queryInteger(1, 10_000).default(1),
    pageSize: queryInteger(1, 50).default(20),
  })
  .strict();

export const safeAuditActionSchema = z.enum([
  'AUTH_SIGNUP_SUCCEEDED',
  'AUTH_SIGNIN_SUCCEEDED',
  'AUTH_SIGNIN_FAILED',
  'AUTH_LOGOUT_SUCCEEDED',
  'SESSION_REJECTED',
  'USER_ROLE_CHANGED',
  'USER_STATUS_CHANGED',
  'ADMIN_BOOTSTRAPPED',
  'ASSISTANT_REFUSED',
]);

export const safeAuditEventSchema = z
  .object({
    id: z.string().min(1),
    action: safeAuditActionSchema,
    occurredAt: z.string().datetime({ offset: true }),
    summary: z.string().min(1).max(240),
  })
  .strict();

export const adminAuditEventsResponseSchema = z
  .object({
    items: z.array(safeAuditEventSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type AdminUserSort = z.infer<typeof adminUserSortSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type AdminUserIdParams = z.infer<typeof adminUserIdParamsSchema>;
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateAdminUserSchema>;
export type UserPage = z.infer<typeof adminUsersResponseSchema>;
export type AdminAuditEventsQuery = z.infer<typeof adminAuditEventsQuerySchema>;
export type SafeAuditAction = z.infer<typeof safeAuditActionSchema>;
export type SafeAuditEvent = z.infer<typeof safeAuditEventSchema>;
export type AuditEventPage = z.infer<typeof adminAuditEventsResponseSchema>;
