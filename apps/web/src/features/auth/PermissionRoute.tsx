import type { Role } from '@easygenerator/contracts';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from './AuthProvider';

export function canViewAdministration(role: Role): boolean {
  return role === 'SUPPORT' || role === 'MANAGER' || role === 'ADMIN';
}

export function PermissionRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user || !canViewAdministration(user.role)) {
    return <Navigate to="/access-denied" replace />;
  }

  return <>{children}</>;
}
