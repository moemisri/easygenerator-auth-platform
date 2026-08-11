import { Button } from '../components/Button';
import { useAuth } from '../features/auth/AuthProvider';
export function ApplicationPage() {
  const { user, logout } = useAuth();
  return (
    <main className="application-page">
      <header>
        <p className="product-mark">EASYGENERATOR</p>
        <nav aria-label="Application navigation">
          <a href="/app">Overview</a>
          {user?.role === 'ADMIN' && <a href="/app">Administration</a>}
          <Button onClick={() => void logout()}>Log out</Button>
        </nav>
      </header>
      <section>
        <p className="eyebrow">Signed in as {user?.email}</p>
        <h1>Welcome to the application.</h1>
        <p>
          {user?.name} <span className="role-badge">{user?.role}</span>
        </p>
      </section>
    </main>
  );
}
