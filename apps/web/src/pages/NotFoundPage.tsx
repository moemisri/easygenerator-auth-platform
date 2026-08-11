import { Link } from 'react-router-dom';
export function NotFoundPage() {
  return (
    <main className="not-found">
      <h1>Page not found.</h1>
      <Link to="/signin">Return to sign in</Link>
    </main>
  );
}
