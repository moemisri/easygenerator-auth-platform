export function LoadingScreen() {
  return (
    <main className="loading-screen" aria-busy="true">
      <p role="status" aria-label="Restoring session">
        Restoring session…
      </p>
    </main>
  );
}
