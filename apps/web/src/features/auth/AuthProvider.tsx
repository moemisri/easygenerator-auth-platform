import type {
  AuthSessionResponse,
  SigninInput,
  SignupInput,
} from '@easygenerator/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiProblem } from '../../lib/api-client';
import { authApi } from './auth-api';

type AuthStatus = 'restoring' | 'anonymous' | 'authenticated';
type AuthContextValue = {
  status: AuthStatus;
  user: AuthSessionResponse['user'] | null;
  csrfToken: string | null;
  signIn: (input: SigninInput) => Promise<void>;
  signUp: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
let restoration: Promise<AuthSessionResponse | null> | undefined;
function restore() {
  restoration ??= authApi.session().catch((error: unknown) => {
    if (error instanceof ApiProblem && error.status === 401) return null;
    return null;
  });
  return restoration;
}

export function AuthProvider({
  children,
  restoreSession = restore,
}: {
  children: ReactNode;
  restoreSession?: (() => Promise<AuthSessionResponse | null>) | undefined;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  useEffect(() => {
    let active = true;
    void restoreSession().then((value) => {
      if (active) {
        setSession(value);
        setStatus(value ? 'authenticated' : 'anonymous');
      }
    });
    return () => {
      active = false;
    };
  }, [restoreSession]);
  const accept = useCallback((value: AuthSessionResponse) => {
    setSession(value);
    setStatus('authenticated');
  }, []);
  const signIn = useCallback(
    async (input: SigninInput) => accept(await authApi.signIn(input)),
    [accept],
  );
  const signUp = useCallback(
    async (input: SignupInput) => accept(await authApi.signUp(input)),
    [accept],
  );
  const logout = useCallback(async () => {
    if (session?.csrfToken) await authApi.logout(session.csrfToken);
    setSession(null);
    setStatus('anonymous');
    await queryClient.invalidateQueries();
  }, [queryClient, session]);
  const value = useMemo(
    () => ({
      status,
      user: session?.user ?? null,
      csrfToken: session?.csrfToken ?? null,
      signIn,
      signUp,
      logout,
    }),
    [session, signIn, signUp, logout, status],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
