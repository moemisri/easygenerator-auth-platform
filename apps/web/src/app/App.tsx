import { AuthProvider } from '../features/auth/AuthProvider';
import { AppErrorBoundary } from './AppErrorBoundary';
import { AppRouter } from './router';
export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
