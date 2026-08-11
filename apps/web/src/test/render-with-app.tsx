import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createQueryClient } from '../app/query-client';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthSessionResponse } from '../features/auth/auth-api';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { ApplicationPage } from '../pages/ApplicationPage';
import { SignInPage } from '../pages/SignInPage';
export function renderWithApp(
  ui: ReactElement,
  options?: { sessionPromise?: Promise<AuthSessionResponse | null> },
) {
  const restoreSession = options?.sessionPromise
    ? () => options.sessionPromise!
    : undefined;
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider restoreSession={restoreSession}>
          <Routes>
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <ApplicationPage />
                </ProtectedRoute>
              }
            />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="*" element={ui} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
