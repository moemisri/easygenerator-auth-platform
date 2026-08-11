import { z } from 'zod';

export const roleSchema = z.enum(['USER', 'SUPPORT', 'MANAGER', 'ADMIN']);
export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

export const safeUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string().min(1),
    role: roleSchema,
    status: userStatusSchema,
    version: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type SafeUser = z.infer<typeof safeUserSchema>;
