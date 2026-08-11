import { Link } from 'react-router-dom';

import { Button } from '../components/Button';
import { ProblemAlert } from '../components/ProblemAlert';
import { AssistantChat } from '../features/assistant/AssistantChat';
import { useAuth } from '../features/auth/AuthProvider';
import { canViewAdministration } from '../features/auth/PermissionRoute';

export function AssistantPage() {
  const { user, isLoggingOut, logout, logoutError } = useAuth();

  return (
    <main className="assistant-page">
      <header className="assistant-shell-header">
        <p className="product-mark">EASYGENERATOR / GUIDE</p>
        <nav aria-label="Application navigation">
          <Link to="/app">Overview</Link>
          <Link to="/assistant" aria-current="page">
            Assistant
          </Link>
          {user && canViewAdministration(user.role) && (
            <Link to="/admin">Administration</Link>
          )}
          <Button
            type="button"
            disabled={isLoggingOut}
            onClick={() => void logout()}
          >
            {isLoggingOut ? 'Signing out' : 'Log out'}
          </Button>
        </nav>
      </header>
      {logoutError && <ProblemAlert message={logoutError} />}
      <section className="assistant-masthead">
        <p className="assistant-identity">
          <span>{user?.email}</span>
          <span className="role-badge">{user?.role}</span>
        </p>
        <div>
          <p className="eyebrow">Public documentation assistant</p>
          <h1>Ask the documentation.</h1>
          <p>
            Follow an answer as it arrives, then inspect the public sources
            selected for it.
          </p>
        </div>
      </section>
      <AssistantChat />
    </main>
  );
}
