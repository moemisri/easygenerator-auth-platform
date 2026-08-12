import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProblemAlert } from './ProblemAlert';

describe('ProblemAlert', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down a Retry-After delay and announces the remaining wait', () => {
    vi.useFakeTimers();
    render(<ProblemAlert message="Too many attempts." retryAfter={2} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 2s.');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 1s.');
  });

  it('resynchronizes the countdown when Retry-After changes', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ProblemAlert message="Too many attempts." retryAfter={4} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 2s.');

    rerender(<ProblemAlert message="Too many attempts." retryAfter={10} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 10s.');
  });

  it('only moves focus when the caller opts in', () => {
    const { rerender } = render(<ProblemAlert message="Background error." />);
    expect(screen.getByRole('alert')).not.toHaveFocus();

    rerender(<ProblemAlert message="Form submission failed." autoFocus />);

    expect(screen.getByRole('alert')).toHaveFocus();
  });
});
