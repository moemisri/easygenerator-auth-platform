import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { LoadingScreen } from '../../components/LoadingScreen';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from './AuthProvider';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, restorationError, retrySession } = useAuth();
  if (status === 'restoring') return <LoadingScreen />;
  if (status === 'error') {
    return (
      <main className="loading-screen">
        <ProblemAlert
          message={restorationError ?? 'Unable to restore your session.'}
        />
        <Button type="button" onClick={retrySession}>
          Retry session restoration
        </Button>
      </main>
    );
  }
  if (status === 'anonymous') return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
