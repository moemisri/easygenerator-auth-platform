import { z } from 'zod';

import { safeUserSchema } from './user.js';

const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Add at least one letter.')
  .regex(/[0-9]/, 'Add at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Add at least one special character.');

export const signupSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email address.').max(254),
    name: z.string().trim().min(3, 'Use at least 3 characters.').max(80),
    password: passwordSchema,
  })
  .strict();

export const signinSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email address.').max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const authSessionResponseSchema = z
  .object({
    user: safeUserSchema,
    csrfToken: z.string().min(32),
    features: z.object({ assistant: z.boolean() }).strict(),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
