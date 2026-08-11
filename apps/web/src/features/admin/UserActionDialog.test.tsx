import type { SafeUser } from '@easygenerator/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createQueryClient } from '../../app/query-client';
import { deferred } from '../../test/deferred';
import { server } from '../../test/server';
import { UserTable } from './UserTable';

const actor: SafeUser = {
  id: 'admin-actor',
  email: 'admin@example.com',
  name: 'Admin operator',
  role: 'ADMIN',
  status: 'ACTIVE',
  version: 9,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const target: SafeUser = {
  id: 'user-ada',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'USER',
  status: 'ACTIVE',
  version: 3,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function renderActions(queryClient: QueryClient = createQueryClient()) {
  queryClient.setQueryData(['admin', 'users', { page: 1 }], { cached: true });
  queryClient.setQueryData(['admin', 'audit-events', { page: 1 }], {
    cached: true,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <UserTable users={[target]} actor={actor} csrfToken={'c'.repeat(32)} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('UserActionDialog', () => {
  it('supports cancel and Escape while restoring focus to its trigger', async () => {
    renderActions();
    const user = userEvent.setup();
    const trigger = screen.getAllByRole('button', {
      name: "Change Ada Lovelace's role",
    })[0]!;

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('confirms exact role copy, sends CSRF and version once, invalidates records, and restores trigger focus', async () => {
    const pending = deferred<HttpResponse<SafeUser>>();
    let requestCount = 0;
    let requestBody: unknown;
    let csrfHeader: string | null = null;
    server.use(
      http.patch('/api/v1/admin/users/:id', async ({ request }) => {
        requestCount += 1;
        requestBody = await request.json();
        csrfHeader = request.headers.get('X-CSRF-Token');
        return pending.promise;
      }),
    );
    const queryClient = renderActions();
    const user = userEvent.setup();
    const trigger = screen.getAllByRole('button', {
      name: "Change Ada Lovelace's role",
    })[0]!;

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "Change Ada Lovelace's role from USER to SUPPORT?",
    );
    const confirm = screen.getByRole('button', { name: 'Change role' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(requestCount).toBe(1);
    expect(requestBody).toEqual({ version: 3, role: 'SUPPORT' });
    expect(csrfHeader).toBe('c'.repeat(32));

    await act(async () => {
      pending.resolve(
        HttpResponse.json({ ...target, role: 'SUPPORT', version: 4 }),
      );
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(
      queryClient.getQueryState(['admin', 'users', { page: 1 }])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['admin', 'audit-events', { page: 1 }])
        ?.isInvalidated,
    ).toBe(true);
  });

  it('uses exact status copy and keeps a standard failure inside the dialog', async () => {
    server.use(
      http.patch('/api/v1/admin/users/:id', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 503,
            detail: 'Account changes are temporarily unavailable.',
            code: 'SERVICE_UNAVAILABLE',
            requestId: 'request-1',
          },
          { status: 503 },
        ),
      ),
    );
    renderActions();
    const user = userEvent.setup();

    await user.click(
      screen.getAllByRole('button', {
        name: "Disable Ada Lovelace's account",
      })[0]!,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "Disable Ada Lovelace's account?",
    );
    await user.click(screen.getByRole('button', { name: 'Disable account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Account changes are temporarily unavailable.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes and announces stale recovery without replaying the mutation', async () => {
    let requestCount = 0;
    server.use(
      http.patch('/api/v1/admin/users/:id', () => {
        requestCount += 1;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'User changed',
            status: 409,
            detail: 'The user record changed before this update.',
            code: 'STALE_USER_VERSION',
            requestId: 'request-stale',
          },
          { status: 409 },
        );
      }),
    );
    const queryClient = renderActions();
    const user = userEvent.setup();

    await user.click(
      screen.getAllByRole('button', {
        name: "Disable Ada Lovelace's account",
      })[0]!,
    );
    await user.click(screen.getByRole('button', { name: 'Disable account' }));

    expect(
      await screen.findByText(
        'Ada Lovelace changed elsewhere. The latest record is now loaded.',
      ),
    ).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestCount).toBe(1);
    expect(
      queryClient.getQueryState(['admin', 'users', { page: 1 }])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['admin', 'audit-events', { page: 1 }])
        ?.isInvalidated,
    ).toBe(true);
  });

  it('shows the safe last-admin conflict and refreshes without closing', async () => {
    server.use(
      http.patch('/api/v1/admin/users/:id', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'LAST_ACTIVE_ADMIN_PROTECTED',
            requestId: 'request-last-admin',
          },
          { status: 409 },
        ),
      ),
    );
    const queryClient = renderActions();
    const user = userEvent.setup();

    await user.click(
      screen.getAllByRole('button', {
        name: "Disable Ada Lovelace's account",
      })[0]!,
    );
    await user.click(screen.getByRole('button', { name: 'Disable account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The last active administrator cannot be disabled or demoted.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(
      queryClient.getQueryState(['admin', 'users', { page: 1 }])?.isInvalidated,
    ).toBe(true);
  });

  it('turns the live forbidden code into safe actionable feedback', async () => {
    server.use(
      http.patch('/api/v1/admin/users/:id', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'TARGET_UPDATE_FORBIDDEN',
            requestId: 'request-forbidden',
          },
          { status: 403 },
        ),
      ),
    );
    renderActions();
    const user = userEvent.setup();

    await user.click(
      screen.getAllByRole('button', {
        name: "Disable Ada Lovelace's account",
      })[0]!,
    );
    await user.click(screen.getByRole('button', { name: 'Disable account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You no longer have permission to update this account.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});
