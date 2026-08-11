import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
const session = {
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
};
export const server = setupServer(
  http.get('/api/v1/auth/session', () =>
    HttpResponse.json(
      { title: 'Unauthenticated', code: 'UNAUTHENTICATED' },
      { status: 401 },
    ),
  ),
  http.post('/api/v1/auth/signin', () =>
    HttpResponse.json(
      { title: 'Unauthenticated', code: 'UNAUTHENTICATED' },
      { status: 401 },
    ),
  ),
  http.post('/api/v1/auth/signup', () => HttpResponse.json(session)),
  http.post(
    '/api/v1/auth/logout',
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get('/api/v1/admin/users', () =>
    HttpResponse.json({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      summary: { total: 0, active: 0 },
    }),
  ),
  http.get('/api/v1/admin/audit-events', () =>
    HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
  ),
);
