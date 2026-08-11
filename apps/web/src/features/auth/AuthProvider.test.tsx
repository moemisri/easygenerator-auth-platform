import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { ApiProblem } from '../../lib/api-client';
import { ApplicationPage } from '../../pages/ApplicationPage';
import { deferred } from '../../test/deferred';
import { renderWithApp } from '../../test/render-with-app';
import { server } from '../../test/server';
import { AuthProvider, useAuth } from './AuthProvider';
import { createQueryClient } from '../../app/query-client';
import { ProtectedRoute } from './ProtectedRoute';

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

  it('clears the session and invalidates cached data after a logout 401', async () => {
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
      queryClient.getQueryCache().find({ queryKey: ['private-data'] })?.state
        .isInvalidated,
    ).toBe(true);
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
});
