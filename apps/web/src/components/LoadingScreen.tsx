export function LoadingScreen({
  label = 'Restoring session',
  message = 'Restoring session…',
}: {
  label?: string | undefined;
  message?: string | undefined;
}) {
  return (
    <main className="loading-screen" aria-busy="true">
      <p role="status" aria-label={label}>
        {message}
      </p>
    </main>
  );
}
