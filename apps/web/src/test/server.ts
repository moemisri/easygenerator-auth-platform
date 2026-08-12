import {
  adminAuditEventsResponseSchema,
  adminUsersResponseSchema,
  authSessionResponseSchema,
  problemDetailsSchema,
} from '@easygenerator/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const session = authSessionResponseSchema.parse({
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
});
const unauthenticated = problemDetailsSchema.parse({
  type: 'https://easygenerator.test/problems/unauthenticated',
  title: 'Unauthenticated',
  status: 401,
  code: 'UNAUTHENTICATED',
  requestId: 'request-test-unauthenticated',
});
const emptyUserPage = adminUsersResponseSchema.parse({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  summary: { total: 0, active: 0 },
});
const emptyAuditPage = adminAuditEventsResponseSchema.parse({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
});

export const server = setupServer(
  http.get('/api/v1/auth/session', () =>
    HttpResponse.json(unauthenticated, { status: 401 }),
  ),
  http.post('/api/v1/auth/signin', () =>
    HttpResponse.json(unauthenticated, { status: 401 }),
  ),
  http.post('/api/v1/auth/signup', () => HttpResponse.json(session)),
  http.post(
    '/api/v1/auth/logout',
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get('/api/v1/admin/users', () => HttpResponse.json(emptyUserPage)),
  http.get('/api/v1/admin/audit-events', () =>
    HttpResponse.json(emptyAuditPage),
  ),
);
