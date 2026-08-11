import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@easygenerator/contracts';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../features/auth/AuthProvider';
import { authApi } from '../features/auth/auth-api';
import { createQueryClient } from './query-client';
import { AppRouter } from './router';

function sessionFor(role: Role) {
  return {
    user: {
      id: `actor-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.com`,
      name: `${role} operator`,
      role,
      status: 'ACTIVE' as const,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    csrfToken: 'a'.repeat(32),
    features: { assistant: false },
  };
}

function renderAppAt(path: string, role?: Role) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider
          restoreSession={() =>
            role ? Promise.resolve(sessionFor(role)) : authApi.session()
          }
        >
          <AppRouter />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the product entry point', () => {
    renderAppAt('/signin');

    expect(
      screen.getByRole('heading', { name: /sign in to continue/i }),
    ).toBeVisible();
  });

  it.each([
    ['USER', false],
    ['SUPPORT', true],
    ['MANAGER', true],
    ['ADMIN', true],
  ] as const)(
    'shows administration navigation for %s: %s',
    async (role, visible) => {
      renderAppAt('/app', role);

      await screen.findByText('Welcome to the application.');
      expect(
        Boolean(screen.queryByRole('link', { name: 'Administration' })),
      ).toBe(visible);
    },
  );

  it.each(['SUPPORT', 'MANAGER', 'ADMIN'] as const)(
    'admits %s to the administration route',
    async (role) => {
      renderAppAt('/admin', role);

      expect(
        await screen.findByRole('heading', { name: 'Administration' }),
      ).toBeVisible();
    },
  );

  it('routes an authenticated USER to access denied', async () => {
    renderAppAt('/admin', 'USER');

    expect(
      await screen.findByRole('heading', { name: 'Access denied' }),
    ).toBeVisible();
  });

  it('keeps identity, overview navigation, and logout available in administration', async () => {
    renderAppAt('/admin', 'MANAGER');

    await screen.findByRole('heading', { name: 'Administration' });
    expect(screen.getByText('manager@example.com')).toBeVisible();
    expect(screen.getByText('MANAGER')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(
      screen.getByRole('link', { name: 'Administration' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  it('routes an anonymous visitor to sign in without rendering protected content', async () => {
    renderAppAt('/admin');

    expect(
      await screen.findByRole('heading', { name: /sign in to continue/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Administration' }),
    ).not.toBeInTheDocument();
  });
});
