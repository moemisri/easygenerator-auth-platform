import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingScreen } from '../../components/LoadingScreen';
import { useAuth } from './AuthProvider';
import { requestedPath } from './auth-navigation';

export function AnonymousRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'restoring') return <LoadingScreen />;
  if (status === 'authenticated') {
    return <Navigate to={requestedPath(location.state)} replace />;
  }
  return <>{children}</>;
}
