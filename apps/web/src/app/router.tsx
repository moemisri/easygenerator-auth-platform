import { Route, Routes } from 'react-router-dom';
import { PermissionRoute } from '../features/auth/PermissionRoute';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';
import { AdminPage } from '../pages/AdminPage';
import { AssistantPage } from '../pages/AssistantPage';
import { ApplicationPage } from '../pages/ApplicationPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SignInPage } from '../pages/SignInPage';
import { SignUpPage } from '../pages/SignUpPage';
export function AppRouter() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
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
  );
}
