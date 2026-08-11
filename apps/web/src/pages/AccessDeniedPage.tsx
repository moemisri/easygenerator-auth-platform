import { Link } from 'react-router-dom';

export function AccessDeniedPage() {
  return (
    <main className="not-found">
      <p className="eyebrow">Restricted area</p>
      <h1>Access denied</h1>
      <p>Your account does not have permission to view administration.</p>
      <Link to="/app">Return to the application</Link>
    </main>
  );
}
