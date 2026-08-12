import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@easygenerator/contracts';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../features/auth/AuthProvider';
import { authApi } from '../features/auth/auth-api';
import { createQueryClient } from './query-client';
import { AppRouter } from './router';
import { server } from '../test/server';

function sessionFor(role: Role, assistant = false) {
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
    features: { assistant },
  };
}

function renderAppAt(path: string, role?: Role, assistant = false) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider
          restoreSession={() =>
            role
              ? Promise.resolve(sessionFor(role, assistant))
              : authApi.session()
          }
        >
          <AppRouter />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the product entry point', async () => {
    renderAppAt('/signin');

    expect(
      await screen.findByRole('heading', { name: /sign in to continue/i }),
    ).toBeVisible();
  });

  it('redirects an authenticated visitor away from authentication pages', async () => {
    renderAppAt('/signin', 'USER');

    expect(
      await screen.findByText('Welcome to the application.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: /sign in to continue/i }),
    ).not.toBeInTheDocument();
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

  it('shows assistant navigation only when the authenticated feature is enabled', async () => {
    renderAppAt('/app', 'USER', true);

    await screen.findByText('Welcome to the application.');
    expect(screen.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'href',
      '/assistant',
    );
  });

  it('does not show assistant navigation when the feature is disabled', async () => {
    renderAppAt('/app', 'USER', false);

    await screen.findByText('Welcome to the application.');
    expect(
      screen.queryByRole('link', { name: 'Assistant' }),
    ).not.toBeInTheDocument();
  });

  it('protects the assistant route and renders the enabled assistant shell', async () => {
    renderAppAt('/assistant', 'USER', true);

    expect(
      await screen.findByRole('heading', { name: 'Ask the documentation.' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('user@example.com')).toBeVisible();
  });

  it('renders a safe disabled state on direct assistant navigation', async () => {
    renderAppAt('/assistant', 'USER', false);

    expect(
      await screen.findByText(/assistant is not enabled for this environment/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Question' }),
    ).not.toBeInTheDocument();
  });

  it('redirects an anonymous assistant visitor without rendering assistant content', async () => {
    renderAppAt('/assistant');

    expect(
      await screen.findByRole('heading', { name: /sign in to continue/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Ask the documentation.' }),
    ).not.toBeInTheDocument();
  });

  it('returns an anonymous visitor to the originally requested route after sign-in', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/auth/signin', () =>
        HttpResponse.json(sessionFor('USER', true)),
      ),
    );
    renderAppAt('/assistant');
    await user.type(await screen.findByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Secure1!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Ask the documentation.' }),
    ).toBeVisible();
  });

  it('preserves the requested route when the visitor switches to sign-up', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/auth/signup', () =>
        HttpResponse.json(sessionFor('USER', true)),
      ),
    );
    renderAppAt('/assistant');

    await user.click(
      await screen.findByRole('link', { name: 'Create an account' }),
    );
    await screen.findByRole('heading', { name: 'Set up your account.' });
    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^name/i), 'User operator');
    await user.type(screen.getByLabelText(/^password$/i), 'Secure1!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'Ask the documentation.' }),
    ).toBeVisible();
  });
});
