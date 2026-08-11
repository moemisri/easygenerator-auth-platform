import {
  authSessionResponseSchema,
  signinSchema,
  signupSchema,
  type AuthSessionResponse,
  type SigninInput,
  type SignupInput,
} from '@easygenerator/contracts';
import { apiClient } from '../../lib/api-client';

export const authApi = {
  session: () =>
    apiClient.request('/api/v1/auth/session', authSessionResponseSchema, {
      authenticationFailure: 'form-or-restoration',
    }),
  signIn: (input: SigninInput) =>
    apiClient.request('/api/v1/auth/signin', authSessionResponseSchema, {
      authenticationFailure: 'form-or-restoration',
      method: 'POST',
      body: signinSchema.parse(input),
    }),
  signUp: (input: SignupInput) =>
    apiClient.request('/api/v1/auth/signup', authSessionResponseSchema, {
      authenticationFailure: 'form-or-restoration',
      method: 'POST',
      body: signupSchema.parse(input),
    }),
  logout: (csrfToken: string) =>
    apiClient.request<void>('/api/v1/auth/logout', undefined, {
      method: 'POST',
      csrfToken,
    }),
};

export type { AuthSessionResponse };
