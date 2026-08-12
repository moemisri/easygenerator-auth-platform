import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingScreen } from '../components/LoadingScreen';
import { PermissionRoute } from '../features/auth/PermissionRoute';
import { AnonymousRoute } from '../features/auth/AnonymousRoute';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';

const AccessDeniedPage = lazy(() =>
  import('../pages/AccessDeniedPage').then((module) => ({
    default: module.AccessDeniedPage,
  })),
);
const AdminPage = lazy(() =>
  import('../pages/AdminPage').then((module) => ({
    default: module.AdminPage,
  })),
);
const AssistantPage = lazy(() =>
  import('../pages/AssistantPage').then((module) => ({
    default: module.AssistantPage,
  })),
);
const ApplicationPage = lazy(() =>
  import('../pages/ApplicationPage').then((module) => ({
    default: module.ApplicationPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((module) => ({
    default: module.NotFoundPage,
  })),
);
const SignInPage = lazy(() =>
  import('../pages/SignInPage').then((module) => ({
    default: module.SignInPage,
  })),
);
const SignUpPage = lazy(() =>
  import('../pages/SignUpPage').then((module) => ({
    default: module.SignUpPage,
  })),
);

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <LoadingScreen
          label="Loading application"
          message="Loading application…"
        />
      }
    >
      <Routes>
        <Route
          path="/signin"
          element={
            <AnonymousRoute>
              <SignInPage />
            </AnonymousRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <AnonymousRoute>
              <SignUpPage />
            </AnonymousRoute>
          }
        />
        <Route path="/access-denied" element={<AccessDeniedPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <ApplicationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <PermissionRoute>
                <AdminPage />
              </PermissionRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assistant"
          element={
            <ProtectedRoute>
              <AssistantPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
