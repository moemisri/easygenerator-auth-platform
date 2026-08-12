import { useEffect, useRef, useState } from 'react';

function RetryCountdown({ retryAfter }: { retryAfter: number }) {
  const [seconds, setSeconds] = useState(retryAfter);

  useEffect(() => {
    const deadline = Date.now() + retryAfter * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      setSeconds(remaining > 0 ? remaining : 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  return seconds > 0 ? <span> Try again in {seconds}s.</span> : null;
}

export function ProblemAlert({
  message,
  retryAfter,
  autoFocus = false,
}: {
  message: string;
  retryAfter?: number | undefined;
  autoFocus?: boolean | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, message]);
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="problem-alert">
      {message}
      {retryAfter ? (
        <RetryCountdown
          key={`${message}:${retryAfter}`}
          retryAfter={retryAfter}
        />
      ) : null}
    </div>
  );
}
