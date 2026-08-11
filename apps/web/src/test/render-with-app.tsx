import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createQueryClient } from '../app/query-client';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthSessionResponse } from '../features/auth/auth-api';
import { ApplicationPage } from '../pages/ApplicationPage';
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
            <Route path="/app" element={<ApplicationPage />} />
            <Route path="*" element={ui} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
