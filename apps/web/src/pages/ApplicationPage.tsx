import { Button } from '../components/Button';
import { ProblemAlert } from '../components/ProblemAlert';
import { useAuth } from '../features/auth/AuthProvider';
import { canViewAdministration } from '../features/auth/PermissionRoute';
import { Link } from 'react-router-dom';
export function ApplicationPage() {
  const { user, features, logout, logoutError } = useAuth();
  return (
    <main className="application-page">
      <header>
        <p className="product-mark">EASYGENERATOR</p>
        <nav aria-label="Application navigation">
          <Link to="/app">Overview</Link>
          {features?.assistant && <Link to="/assistant">Assistant</Link>}
          {user && canViewAdministration(user.role) && (
            <Link to="/admin">Administration</Link>
          )}
          <Button onClick={() => void logout()}>Log out</Button>
        </nav>
      </header>
      <section>
        {logoutError && <ProblemAlert message={logoutError} />}
        <p className="eyebrow">Signed in as {user?.email}</p>
        <h1>Welcome to the application.</h1>
        <p>
          {user?.name} <span className="role-badge">{user?.role}</span>
        </p>
      </section>
    </main>
  );
}
