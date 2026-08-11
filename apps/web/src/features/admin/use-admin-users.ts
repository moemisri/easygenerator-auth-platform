import type {
  AdminAuditEventsQuery,
  AdminUsersQuery,
} from '@easygenerator/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { adminApi } from './admin-api';

export const adminQueryKeys = {
  users: (query: AdminUsersQuery) => ['admin', 'users', query] as const,
  auditEvents: (query: AdminAuditEventsQuery) =>
    ['admin', 'audit-events', query] as const,
};

export function useAdminUsers(query: AdminUsersQuery) {
  return useQuery({
    queryKey: adminQueryKeys.users(query),
    queryFn: ({ signal }) => adminApi.users(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminAuditEvents(query: AdminAuditEventsQuery) {
  return useQuery({
    queryKey: adminQueryKeys.auditEvents(query),
    queryFn: ({ signal }) => adminApi.auditEvents(query, signal),
    placeholderData: keepPreviousData,
  });
}
