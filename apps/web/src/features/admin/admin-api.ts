import {
  adminAuditEventsQuerySchema,
  adminAuditEventsResponseSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  safeUserSchema,
  updateAdminUserSchema,
  type AdminAuditEventsQuery,
  type AdminUsersQuery,
  type UpdateUserInput,
} from '@easygenerator/contracts';

import { apiClient } from '../../lib/api-client';

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const adminApi = {
  users: (input: AdminUsersQuery, signal: AbortSignal) => {
    const query = adminUsersQuerySchema.parse(input);
    return apiClient.request(
      `/api/v1/admin/users?${queryString(query)}`,
      adminUsersResponseSchema,
      { signal },
    );
  },
  auditEvents: (input: AdminAuditEventsQuery, signal: AbortSignal) => {
    const query = adminAuditEventsQuerySchema.parse(input);
    return apiClient.request(
      `/api/v1/admin/audit-events?${queryString(query)}`,
      adminAuditEventsResponseSchema,
      { signal },
    );
  },
  updateUser: (id: string, input: UpdateUserInput, csrfToken: string) =>
    apiClient.request(
      `/api/v1/admin/users/${encodeURIComponent(id)}`,
      safeUserSchema,
      {
        method: 'PATCH',
        body: updateAdminUserSchema.parse(input),
        csrfToken,
      },
    ),
};
