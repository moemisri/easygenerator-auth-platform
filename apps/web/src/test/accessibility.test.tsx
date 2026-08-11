import type { SafeUser } from '@easygenerator/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import { AppRouter } from '../app/router';
import { createQueryClient } from '../app/query-client';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthSessionResponse } from '../features/auth/auth-api';
import { server } from './server';

const baseUser: SafeUser = {
  id: 'user-accessibility',
  email: 'ada@example.com',
  name: 'Ada Tester',
  role: 'USER',
  status: 'ACTIVE',
  version: 0,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

function session(
  user: SafeUser = baseUser,
  assistant = false,
): AuthSessionResponse {
  return {
    user,
    csrfToken: 'a'.repeat(32),
    features: { assistant },
  };
}

function renderRoute(
  path: string,
  restoredSession: AuthSessionResponse | null = null,
) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider restoreSession={() => Promise.resolve(restoredSession)}>
          <AppRouter />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expectNoSeriousOrCriticalViolations(container: Element) {
  const result = await axe(container, {
    // jsdom has no layout engine, so axe cannot evaluate color contrast here.
    rules: { 'color-contrast': { enabled: false } },
  });
  const violations = result.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  );
  expect(violations).toEqual([]);
}

describe('route accessibility', () => {
  it.each([
    ['/signup', 'Set up your account.'],
    ['/signin', 'Sign in to continue.'],
  ])('has no serious or critical issues on %s', async (path, heading) => {
    const { container } = renderRoute(path);
    await screen.findByRole('heading', { name: heading });

    await expectNoSeriousOrCriticalViolations(container);
  });

  it('covers the restored protected application route', async () => {
    const { container } = renderRoute('/app', session());
    await screen.findByRole('heading', {
      name: 'Welcome to the application.',
    });

    await expectNoSeriousOrCriticalViolations(container);
  });

  it('covers the loaded admin route and its confirmation dialog', async () => {
    const admin: SafeUser = {
      ...baseUser,
      id: 'admin-accessibility',
      role: 'ADMIN',
    };
    const target: SafeUser = {
      ...baseUser,
      id: 'target-accessibility',
      email: 'grace@example.com',
      name: 'Grace Tester',
    };
    server.use(
      http.get('/api/v1/admin/users', () =>
        HttpResponse.json({
          items: [admin, target],
          page: 1,
          pageSize: 20,
          total: 2,
          summary: { total: 2, active: 2 },
        }),
      ),
      http.get('/api/v1/admin/audit-events', () =>
        HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    );
    const { container } = renderRoute('/admin', session(admin));
    await screen.findByRole('table', { name: 'User directory' });
    await expectNoSeriousOrCriticalViolations(container);

    await userEvent.setup().click(
      screen.getAllByRole('button', {
        name: "Change Grace Tester's role",
      })[0]!,
    );
    await screen.findByRole('dialog');
    await expectNoSeriousOrCriticalViolations(document.body);
  });

  it.each([
    [false, 'The assistant is not enabled for this environment.'],
    [true, 'Ask about access, security, or this application.'],
  ])('covers the assistant enabled=%s state', async (enabled, heading) => {
    const { container } = renderRoute('/assistant', session(baseUser, enabled));
    await screen.findByRole('heading', { name: heading });

    await expectNoSeriousOrCriticalViolations(container);
  });
});
