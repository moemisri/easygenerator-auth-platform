import type {
  AuditEventPage,
  SafeUser,
  UserPage,
} from '@easygenerator/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRouter } from '../../app/router';
import { createQueryClient } from '../../app/query-client';
import { AuthProvider } from '../auth/AuthProvider';
import { server } from '../../test/server';

const actor: SafeUser = {
  id: 'support-1',
  email: 'support@example.com',
  name: 'Support operator',
  role: 'SUPPORT',
  status: 'ACTIVE',
  version: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const ada: SafeUser = {
  id: 'user-ada',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'USER',
  status: 'ACTIVE',
  version: 3,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const grace: SafeUser = {
  ...ada,
  id: 'user-grace',
  email: 'grace@example.com',
  name: 'Grace Hopper',
  role: 'SUPPORT',
  status: 'DISABLED',
  version: 7,
};

function userPage(
  items: SafeUser[] = [ada],
  overrides: Partial<UserPage> = {},
): UserPage {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    summary: { total: 42, active: 37 },
    ...overrides,
  };
}

function auditPage(overrides: Partial<AuditEventPage> = {}): AuditEventPage {
  return {
    items: [
      {
        id: 'audit-secret-1',
        action: 'USER_ROLE_CHANGED',
        occurredAt: '2026-08-11T12:30:00.000Z',
        summary: 'A user role changed from USER to SUPPORT.',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    ...overrides,
  };
}

function renderAdmin({
  path = '/admin',
  users = () => HttpResponse.json(userPage()),
  audits = () => HttpResponse.json(auditPage()),
  sessionUser = actor,
}: {
  path?: string;
  users?: HttpResponseResolver;
  audits?: HttpResponseResolver;
  sessionUser?: SafeUser;
} = {}) {
  server.use(
    http.get('/api/v1/admin/users', users),
    http.get('/api/v1/admin/audit-events', audits),
  );

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider
          restoreSession={() =>
            Promise.resolve({
              user: sessionUser,
              csrfToken: 'c'.repeat(32),
              features: { assistant: false },
            })
          }
        >
          <AppRouter />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminDashboard', () => {
  it('renders server summaries, a semantic directory, mobile records, and redacted audits', async () => {
    renderAdmin();

    expect(await screen.findByText('42')).toBeVisible();
    expect(screen.getByText('37')).toBeVisible();
    expect(screen.getByText('1 result')).toBeVisible();
    const table = screen.getByRole('table', { name: 'User directory' });
    expect(within(table).getByText('Ada Lovelace')).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'User directory cards' }),
    ).toBeInTheDocument();
    expect(screen.getByText('USER_ROLE_CHANGED')).toBeVisible();
    expect(
      screen.getByText('A user role changed from USER to SUPPORT.'),
    ).toBeVisible();
    expect(screen.queryByText('audit-secret-1')).not.toBeInTheDocument();
  });

  it('commits search after 250ms, resets the page, retains prior data, and aborts superseded work', async () => {
    const requests: string[] = [];
    let searchAborted = false;
    renderAdmin({
      path: '/admin?page=2',
      users: async ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search') ?? '';
        requests.push(`${url.searchParams.get('page')}:${search}`);
        if (search === 'Ada') {
          return new Promise<HttpResponse<UserPage>>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => {
              searchAborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
        if (search === 'Grace') return HttpResponse.json(userPage([grace]));
        return HttpResponse.json(userPage([ada], { page: 2, total: 41 }));
      },
    });
    const user = userEvent.setup();

    expect((await screen.findAllByText('Ada Lovelace'))[0]).toBeVisible();
    const search = screen.getByRole('searchbox', { name: 'Search users' });
    await user.type(search, 'Ada');
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(requests).toEqual(['2:']);

    await waitFor(() => expect(requests).toContain('1:Ada'));
    expect(screen.getAllByText('Ada Lovelace')[0]).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Updating results');

    await user.clear(search);
    await user.type(search, 'Grace');
    expect((await screen.findAllByText('Grace Hopper'))[0]).toBeVisible();
    expect(searchAborted).toBe(true);
    expect(requests).toContain('1:Grace');
  });

  it('uses server pagination and disables unavailable directions', async () => {
    const requestedPages: string[] = [];
    renderAdmin({
      users: ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '';
        requestedPages.push(page);
        return HttpResponse.json(
          page === '2'
            ? userPage([grace], { page: 2, total: 21 })
            : userPage([ada], { total: 21 }),
        );
      },
    });
    const user = userEvent.setup();

    await screen.findAllByText('Ada Lovelace');
    expect(
      screen.getByRole('button', { name: 'Previous users page' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next users page' }));
    expect((await screen.findAllByText('Grace Hopper'))[0]).toBeVisible();
    expect(requestedPages).toEqual(['1', '2']);
    expect(
      screen.getByRole('button', { name: 'Next users page' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Previous users page' }),
    ).toBeEnabled();
  });

  it('keeps user and audit loading, empty, and failure recovery independent', async () => {
    let usersAttempt = 0;
    renderAdmin({
      users: () => {
        usersAttempt += 1;
        return usersAttempt === 1
          ? HttpResponse.json(
              { title: 'Directory unavailable', status: 503 },
              { status: 503 },
            )
          : HttpResponse.json(userPage());
      },
      audits: () => HttpResponse.json(auditPage({ items: [], total: 0 })),
    });
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load users',
    );
    expect(screen.getByText('No audit events yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry users' }));
    expect((await screen.findAllByText('Ada Lovelace'))[0]).toBeVisible();
  });

  it('retries an audit failure without replacing loaded users', async () => {
    let auditAttempt = 0;
    renderAdmin({
      audits: () => {
        auditAttempt += 1;
        return auditAttempt === 1
          ? HttpResponse.json(
              { title: 'Audit unavailable', status: 503 },
              { status: 503 },
            )
          : HttpResponse.json(auditPage());
      },
    });
    const user = userEvent.setup();

    expect((await screen.findAllByText('Ada Lovelace'))[0]).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load audit events',
    );
    await user.click(
      screen.getByRole('button', { name: 'Retry audit events' }),
    );
    expect(await screen.findByText('USER_ROLE_CHANGED')).toBeVisible();
    expect(screen.getAllByText('Ada Lovelace')[0]).toBeVisible();
  });

  it('refetches active user and audit queries after stale-version recovery', async () => {
    let userReads = 0;
    let auditReads = 0;
    let patchRequests = 0;
    renderAdmin({
      sessionUser: { ...actor, id: 'admin-1', role: 'ADMIN' },
      users: () => {
        userReads += 1;
        return HttpResponse.json(userPage());
      },
      audits: () => {
        auditReads += 1;
        return HttpResponse.json(auditPage());
      },
    });
    server.use(
      http.patch('/api/v1/admin/users/:id', () => {
        patchRequests += 1;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'User changed',
            status: 409,
            detail: 'The user record changed before this update.',
            code: 'STALE_USER_VERSION',
            requestId: 'request-stale-active',
          },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();

    await screen.findAllByText('Ada Lovelace');
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
    ).toBeVisible();
    await waitFor(() => {
      expect(userReads).toBe(2);
      expect(auditReads).toBe(2);
    });
    expect(patchRequests).toBe(1);
  });
});
