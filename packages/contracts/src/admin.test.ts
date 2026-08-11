import { describe, expect, it } from 'vitest';

import {
  adminAuditEventsQuerySchema,
  adminAuditEventsResponseSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  updateAdminUserSchema,
} from './admin.js';

describe('adminUsersQuerySchema', () => {
  it('applies bounded deterministic defaults', () => {
    expect(adminUsersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      direction: 'desc',
    });
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '51' }, 'pageSize'],
    [{ search: 'x'.repeat(101) }, 'search'],
    [{ sort: 'passwordHash' }, 'sort'],
    [{ direction: 'sideways' }, 'direction'],
    [{ unexpected: 'value' }, 'request'],
  ])('rejects unsafe user query %#', (query, field) => {
    const result = adminUsersQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
    if (!result.success && field === 'request') {
      expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('trims search and accepts only safe sorting controls', () => {
    expect(
      adminUsersQuerySchema.parse({
        page: '2',
        pageSize: '50',
        search: '  Ada.*  ',
        sort: 'email',
        direction: 'asc',
      }),
    ).toEqual({
      page: 2,
      pageSize: 50,
      search: 'Ada.*',
      sort: 'email',
      direction: 'asc',
    });
  });
});

describe('updateAdminUserSchema', () => {
  it.each([
    [{ version: 0, role: 'SUPPORT' }],
    [{ version: 12, status: 'DISABLED' }],
    [{ version: 2, role: 'ADMIN', status: 'ACTIVE' }],
  ])('accepts an expected version and a proposed change', (body) => {
    expect(updateAdminUserSchema.parse(body)).toEqual(body);
  });

  it.each([
    [{}, 'version'],
    [{ version: -1, role: 'USER' }, 'version'],
    [{ version: 1.5, role: 'USER' }, 'version'],
    [{ version: 0 }, 'request'],
    [{ version: 0, role: 'OWNER' }, 'role'],
    [{ version: 0, status: 'PENDING' }, 'status'],
    [{ version: 0, role: 'USER', passwordHash: 'secret' }, 'request'],
  ])('rejects unsafe update body %#', (body, field) => {
    const result = updateAdminUserSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success && field === 'request') {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === 'unrecognized_keys' || issue.path.length === 0,
        ),
      ).toBe(true);
    }
  });
});

describe('adminAuditEventsQuerySchema', () => {
  it('defaults and bounds audit pagination', () => {
    expect(adminAuditEventsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      adminAuditEventsQuerySchema.parse({ page: '3', pageSize: '50' }),
    ).toEqual({ page: 3, pageSize: 50 });
  });

  it.each([
    { page: '0' },
    { pageSize: '51' },
    { pageSize: '2.5' },
    { sort: 'metadata' },
  ])('rejects unsafe audit query %#', (query) => {
    expect(adminAuditEventsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('strict safe admin responses', () => {
  const user = {
    id: '507f1f77bcf86cd799439011',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    version: 2,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  };

  it('accepts only the safe user page shape', () => {
    const response = {
      items: [user],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: { total: 3, active: 2 },
    };
    expect(adminUsersResponseSchema.parse(response)).toEqual(response);
    expect(
      adminUsersResponseSchema.safeParse({ ...response, emailKey: 'secret' })
        .success,
    ).toBe(false);
  });

  it('accepts only presentation-safe audit fields and allowlisted actions', () => {
    const response = {
      items: [
        {
          id: 'event-id',
          action: 'USER_ROLE_CHANGED' as const,
          occurredAt: '2026-08-02T10:00:00.000Z',
          summary: 'A user role changed from USER to SUPPORT.',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    expect(adminAuditEventsResponseSchema.parse(response)).toEqual(response);
    expect(
      adminAuditEventsResponseSchema.safeParse({
        ...response,
        items: [{ ...response.items[0], metadata: { token: 'secret' } }],
      }).success,
    ).toBe(false);
    expect(
      adminAuditEventsResponseSchema.safeParse({
        ...response,
        items: [{ ...response.items[0], action: 'PASSWORD_EXPORTED' }],
      }).success,
    ).toBe(false);
  });
});
