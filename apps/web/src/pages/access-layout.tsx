import type { ReactNode } from 'react';
export function AccessLayout({ children }: { children: ReactNode }) {
  return (
    <main className="access-layout">
      <aside className="trust-panel" aria-label="Access verification">
        <div>
          <p className="product-mark">EASYGENERATOR / ACCESS</p>
          <h2>Work moves faster when access is certain.</h2>
          <p>Secure, role-aware entry for professional teams.</p>
        </div>
        <ol className="verification-rail">
          <li>Identity</li>
          <li>Password</li>
          <li>Session</li>
          <li>Ready</li>
        </ol>
      </aside>
      <section className="form-surface">{children}</section>
    </main>
  );
}
