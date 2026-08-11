import { Link } from 'react-router-dom';

import { Button } from '../components/Button';
import { ProblemAlert } from '../components/ProblemAlert';
import { AdminDashboard } from '../features/admin/AdminDashboard';
import { useAuth } from '../features/auth/AuthProvider';

export function AdminPage() {
  const { user, logout, logoutError } = useAuth();

  return (
    <main className="admin-page">
      <header className="admin-shell-header">
        <p className="product-mark">EASYGENERATOR / OPERATIONS</p>
        <nav aria-label="Application navigation">
          <Link to="/app">Overview</Link>
          <Link to="/admin" aria-current="page">
            Administration
          </Link>
          <Button type="button" onClick={() => void logout()}>
            Log out
          </Button>
        </nav>
      </header>
      {logoutError && <ProblemAlert message={logoutError} />}
      <section className="admin-masthead">
        <p className="admin-identity">
          <span>{user?.email}</span>
          <span className="role-badge">{user?.role}</span>
        </p>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Administration</h1>
          <p>Review access and the safe operational record.</p>
        </div>
      </section>
      <AdminDashboard />
    </main>
  );
}
