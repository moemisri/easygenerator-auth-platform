import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingScreen } from '../../components/LoadingScreen';
import { useAuth } from './AuthProvider';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'restoring') return <LoadingScreen />;
  if (status === 'anonymous') return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
