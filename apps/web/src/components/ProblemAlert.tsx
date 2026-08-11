import { useEffect, useRef, useState } from 'react';
export function ProblemAlert({
  message,
  retryAfter,
}: {
  message: string;
  retryAfter?: number | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(retryAfter);
  useEffect(() => {
    ref.current?.focus();
  }, [message]);
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setInterval(
      () => setSeconds((value) => (value && value > 1 ? value - 1 : undefined)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [seconds]);
  return (
    <div
      ref={ref}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className="problem-alert"
    >
      {message}
      {seconds && <span> Try again in {seconds}s.</span>}
    </div>
  );
}
