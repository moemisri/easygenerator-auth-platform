import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { ApiProblem, apiClient } from '../../lib/api-client';
import { ApplicationPage } from '../../pages/ApplicationPage';
import { deferred } from '../../test/deferred';
import { renderWithApp } from '../../test/render-with-app';
import { server } from '../../test/server';
import { AuthProvider, useAuth } from './AuthProvider';
import { createQueryClient } from '../../app/query-client';
import { registerAssistantStream } from '../assistant/assistant-stream-registry';
import { publishAuthExpiry, subscribeToAuthExpiry } from './auth-expiry';
import type { AuthSessionResponse } from './auth-api';
import { ProtectedRoute } from './ProtectedRoute';
import { SignInForm } from './SignInForm';

const adminSession: AuthSessionResponse = {
  user: {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  csrfToken: 'a'.repeat(32),
  features: { assistant: true },
};
const adminCacheKey = ['admin', 'users', { page: 1 }] as const;

function AuthStateControls() {
  const { csrfToken, retrySession, signIn, status } = useAuth();
  return (
    <>
      <p data-testid="auth-status">{status}</p>
      <p data-testid="auth-csrf">{csrfToken ?? 'no csrf'}</p>
      <button
        type="button"
        onClick={() =>
          void signIn({
            email: 'admin@example.com',
            password: 'Secure1!',
          })
        }
      >
        Establish admin session
      </button>
      <button type="button" onClick={retrySession}>
        Retry restoration
      </button>
    </>
  );
}

function ExpiryAdminView() {
  const query = useQuery<{ value: string }>({
    queryKey: adminCacheKey,
    queryFn: ({ signal }) =>
      apiClient.request('/api/v1/admin/users', undefined, { signal }),
  });
  return <p>{query.data?.value}</p>;
}

function AuthErrorProbe() {
  const { logout, logoutError, restorationError, status } = useAuth();
  return (
    <>
      <p data-testid="error-probe-status">{status}</p>
      <p>{restorationError ?? 'no restoration error'}</p>
      <p>{logoutError ?? 'no logout error'}</p>
      <button type="button" onClick={() => void logout()}>
        Probe logout
      </button>
    </>
  );
}

function AuthProbe() {
  const { signIn, status, user } = useAuth();
  return (
    <>
      <p>{status}</p>
      <p>{user?.name ?? 'No user'}</p>
      <button
        type="button"
        onClick={() =>
          void signIn({ email: 'ada@example.com', password: 'Secure1!' })
        }
      >
        Sign in
      </button>
    </>
  );
}

describe('AuthProvider', () => {
  it('does not render a protected route until restoration completes', () => {
    const pendingSession = deferred<never>();
    renderWithApp(
      <ProtectedRoute>
        <ApplicationPage />
      </ProtectedRoute>,
      { sessionPromise: pendingSession.promise },
    );
    expect(
      screen.getByRole('status', { name: /restoring session/i }),
    ).toBeVisible();
    expect(
      screen.queryByText('Welcome to the application.'),
    ).not.toBeInTheDocument();
  });

  it('does not let a stale restoration overwrite a completed sign-in', async () => {
    const user = userEvent.setup();
    const pendingSession = deferred<null>();
    server.use(
      http.post('/api/v1/auth/signin', () =>
        HttpResponse.json({
          user: {
            id: 'user-1',
            email: 'ada@example.com',
            name: 'Ada',
            role: 'USER',
            status: 'ACTIVE',
            version: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          csrfToken: 'a'.repeat(32),
          features: { assistant: false },
        }),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <AuthProvider restoreSession={() => pendingSession.promise}>
            <AuthProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Ada')).toBeVisible();
    await act(async () => {
      pendingSession.resolve(null);
      await pendingSession.promise;
    });
    expect(screen.getByText('authenticated')).toBeVisible();
  });

  it('deduplicates session restoration under StrictMode', async () => {
    let sessionRequests = 0;
    server.use(
      http.get('/api/v1/auth/session', () => {
        sessionRequests += 1;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unauthenticated',
            status: 401,
            code: 'UNAUTHENTICATED',
            requestId: 'req-session',
          },
          { status: 401 },
        );
      }),
    );
    render(
      <StrictMode>
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <AuthProvider>
              <AuthProbe />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(await screen.findByText('anonymous')).toBeVisible();
    expect(sessionRequests).toBe(1);
  });

  it('keeps restored identity and CSRF state out of browser storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <AuthProvider
            restoreSession={() =>
              Promise.resolve({
                user: {
                  id: 'user-1',
                  email: 'ada@example.com',
                  name: 'Ada',
                  role: 'USER',
                  status: 'ACTIVE',
                  version: 0,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
                csrfToken: 'a'.repeat(32),
                features: { assistant: false },
              })
            }
          >
            <AuthProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Ada')).toBeVisible();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps a protected route blocked and offers recovery after a non-401 restoration failure', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/app']}>
          <AuthProvider
            restoreSession={() =>
              Promise.reject(new ApiProblem(503, 'Service unavailable'))
            }
          >
            <Routes>
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <ApplicationPage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /restore your session/i,
    );
    expect(
      screen.getByRole('button', { name: /retry session restoration/i }),
    ).toBeVisible();
    expect(
      screen.queryByText('Welcome to the application.'),
    ).not.toBeInTheDocument();
  });

  it('clears the session and removes cached data after a logout 401', async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    queryClient.setQueryData(['private-data'], { value: 'sensitive' });
    server.use(
      http.post('/api/v1/auth/logout', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unauthenticated',
            status: 401,
            code: 'UNAUTHENTICATED',
            requestId: 'req-logout',
          },
          { status: 401 },
        ),
      ),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app']}>
          <AuthProvider
            restoreSession={() =>
              Promise.resolve({
                user: {
                  id: 'user-1',
                  email: 'ada@example.com',
                  name: 'Ada',
                  role: 'USER',
                  status: 'ACTIVE',
                  version: 0,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
                csrfToken: 'a'.repeat(32),
                features: { assistant: false },
              })
            }
          >
            <Routes>
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <ApplicationPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/signin" element={<h1>Sign in</h1>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Welcome to the application.');
    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeVisible();
    expect(
      queryClient.getQueryCache().find({ queryKey: ['private-data'] }),
    ).toBeUndefined();
  });

  it('preserves the authenticated view and surfaces a safe error after another logout failure', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/auth/logout', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            requestId: 'req-logout',
          },
          { status: 503 },
        ),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/app']}>
          <AuthProvider
            restoreSession={() =>
              Promise.resolve({
                user: {
                  id: 'user-1',
                  email: 'ada@example.com',
                  name: 'Ada',
                  role: 'USER',
                  status: 'ACTIVE',
                  version: 0,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
                csrfToken: 'a'.repeat(32),
                features: { assistant: false },
              })
            }
          >
            <Routes>
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <ApplicationPage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Welcome to the application.');
    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /unable to sign out/i,
    );
    expect(screen.getByText('Welcome to the application.')).toBeVisible();
  });

  it('revokes local authority and cached admin data before a stale restoration can settle', async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const sensitiveSentinel = 'private-admin-sentinel';
    const oldRestoration = deferred<AuthSessionResponse>();
    const adminRequestStarted = deferred<void>();
    const releaseAdminRequest = deferred<void>();
    let sessionRequests = 0;
    const abortStream = vi.fn();
    const unregisterStream = registerAssistantStream(abortStream);
    queryClient.setQueryData(adminCacheKey, { value: sensitiveSentinel });
    server.use(
      http.get('/api/v1/auth/session', async () => {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return HttpResponse.json(await oldRestoration.promise);
        }
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unauthenticated',
            status: 401,
            code: 'UNAUTHENTICATED',
            requestId: 'req-fresh-restoration',
          },
          { status: 401 },
        );
      }),
      http.post('/api/v1/auth/signin', () => HttpResponse.json(adminSession)),
      http.get('/api/v1/admin/users', async () => {
        adminRequestStarted.resolve();
        await releaseAdminRequest.promise;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unauthenticated',
            status: 401,
            code: 'UNAUTHENTICATED',
            requestId: 'req-admin-expired',
          },
          { status: 401 },
        );
      }),
    );

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/admin']}>
            <AuthProvider>
              <AuthStateControls />
              <Routes>
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute>
                      <ExpiryAdminView />
                    </ProtectedRoute>
                  }
                />
                <Route path="/signin" element={<h1>Sign in</h1>} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await vi.waitFor(() => expect(sessionRequests).toBe(1));

      await user.click(
        screen.getByRole('button', { name: 'Establish admin session' }),
      );
      expect(await screen.findByText(sensitiveSentinel)).toBeVisible();
      await adminRequestStarted.promise;

      releaseAdminRequest.resolve();

      expect(
        await screen.findByRole('heading', { name: 'Sign in' }),
      ).toBeVisible();
      expect(screen.queryByText(sensitiveSentinel)).not.toBeInTheDocument();
      expect(
        queryClient.getQueryCache().find({
          queryKey: adminCacheKey,
          exact: true,
        }),
      ).toBeUndefined();
      expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
      expect(screen.getByTestId('auth-csrf')).toHaveTextContent('no csrf');
      expect(abortStream).toHaveBeenCalledOnce();

      await user.click(
        screen.getByRole('button', { name: 'Retry restoration' }),
      );
      await vi.waitFor(() => expect(sessionRequests).toBe(2));

      await act(async () => {
        oldRestoration.resolve(adminSession);
        await oldRestoration.promise;
      });

      await vi.waitFor(() =>
        expect(screen.getByTestId('auth-status')).toHaveTextContent(
          'anonymous',
        ),
      );
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      expect(screen.queryByText(sensitiveSentinel)).not.toBeInTheDocument();
    } finally {
      unregisterStream();
    }
  });

  it('keeps invalid signin feedback local without clearing unrelated cache', async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthExpiry(listener);
    queryClient.setQueryData(['unrelated-public-data'], {
      value: 'public-sentinel',
    });
    server.use(
      http.post('/api/v1/auth/signin', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid credentials',
            status: 401,
            code: 'INVALID_CREDENTIALS',
            requestId: 'req-invalid-credentials',
          },
          { status: 401 },
        ),
      ),
    );

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/signin']}>
            <AuthProvider restoreSession={() => Promise.resolve(null)}>
              <Routes>
                <Route path="/signin" element={<SignInForm />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
      await user.type(screen.getByLabelText(/^password$/i), 'Wrong1!');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /check your email and password/i,
      );
      expect(
        screen.getByRole('heading', { name: 'Sign in to continue.' }),
      ).toBeVisible();
      expect(listener).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(['unrelated-public-data'])).toEqual({
        value: 'public-sentinel',
      });
    } finally {
      unsubscribe();
    }
  });

  it('routes a provider-owned restoration 401 through full revocation', async () => {
    const queryClient = createQueryClient();
    const abortStream = vi.fn();
    const unregisterStream = registerAssistantStream(abortStream);
    queryClient.setQueryData(['private-restoration-data'], {
      value: 'sensitive',
    });

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AuthProvider
              restoreSession={() =>
                Promise.reject(new ApiProblem(401, 'Unauthenticated'))
              }
            >
              <AuthErrorProbe />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(await screen.findByTestId('error-probe-status')).toHaveTextContent(
        'anonymous',
      );
      expect(
        queryClient.getQueryCache().find({
          queryKey: ['private-restoration-data'],
        }),
      ).toBeUndefined();
      expect(abortStream).toHaveBeenCalledOnce();
    } finally {
      unregisterStream();
    }
  });

  it('clears a restoration error when authentication expires', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <AuthProvider
            restoreSession={() =>
              Promise.reject(new ApiProblem(503, 'Service unavailable'))
            }
          >
            <AuthErrorProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(/unable to restore your session/i),
    ).toBeVisible();

    act(() => publishAuthExpiry());

    expect(screen.getByTestId('error-probe-status')).toHaveTextContent(
      'anonymous',
    );
    expect(screen.getByText('no restoration error')).toBeVisible();
  });

  it('clears a logout error when authentication expires', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/auth/logout', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            requestId: 'req-probe-logout',
          },
          { status: 503 },
        ),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <AuthProvider restoreSession={() => Promise.resolve(adminSession)}>
            <AuthErrorProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await vi.waitFor(() =>
      expect(screen.getByTestId('error-probe-status')).toHaveTextContent(
        'authenticated',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Probe logout' }));
    expect(await screen.findByText(/unable to sign out/i)).toBeVisible();

    act(() => publishAuthExpiry());

    expect(screen.getByTestId('error-probe-status')).toHaveTextContent(
      'anonymous',
    );
    expect(screen.getByText('no logout error')).toBeVisible();
  });
});
