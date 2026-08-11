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
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiProblem } from '../../lib/api-client';
import { authApi } from './auth-api';

type AuthStatus = 'restoring' | 'anonymous' | 'authenticated' | 'error';
type AuthContextValue = {
  status: AuthStatus;
  user: AuthSessionResponse['user'] | null;
  csrfToken: string | null;
  restorationError: string | null;
  logoutError: string | null;
  retrySession: () => void;
  signIn: (input: SigninInput) => Promise<void>;
  signUp: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
let restoration: Promise<AuthSessionResponse> | undefined;
function restore() {
  restoration ??= authApi.session();
  const pending = restoration;
  void pending.then(
    () => {
      if (restoration === pending) restoration = undefined;
    },
    () => {
      if (restoration === pending) restoration = undefined;
    },
  );
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
  const [restorationError, setRestorationError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [restorationAttempt, setRestorationAttempt] = useState(0);
  const restorationGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    const generation = restorationGeneration.current;
    void restoreSession()
      .then((value) => {
        if (active && generation === restorationGeneration.current) {
          setSession(value);
          setStatus(value ? 'authenticated' : 'anonymous');
        }
      })
      .catch((error: unknown) => {
        if (!active || generation !== restorationGeneration.current) return;
        if (error instanceof ApiProblem && error.status === 401) {
          setSession(null);
          setStatus('anonymous');
          return;
        }
        setRestorationError('Unable to restore your session. Please retry.');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [restoreSession, restorationAttempt]);
  const retrySession = useCallback(() => {
    restorationGeneration.current += 1;
    setRestorationError(null);
    setLogoutError(null);
    setStatus('restoring');
    setRestorationAttempt((attempt) => attempt + 1);
  }, []);
  const accept = useCallback((value: AuthSessionResponse) => {
    restorationGeneration.current += 1;
    setRestorationError(null);
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
    try {
      if (session?.csrfToken) await authApi.logout(session.csrfToken);
    } catch (error) {
      if (!(error instanceof ApiProblem) || error.status !== 401) {
        setLogoutError('Unable to sign out. Please retry.');
        return;
      }
    }
    setSession(null);
    setStatus('anonymous');
    setLogoutError(null);
    await queryClient.invalidateQueries();
  }, [queryClient, session]);
  const value = useMemo(
    () => ({
      status,
      user: session?.user ?? null,
      csrfToken: session?.csrfToken ?? null,
      restorationError,
      logoutError,
      retrySession,
      signIn,
      signUp,
      logout,
    }),
    [
      session,
      signIn,
      signUp,
      logout,
      restorationError,
      logoutError,
      retrySession,
      status,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
