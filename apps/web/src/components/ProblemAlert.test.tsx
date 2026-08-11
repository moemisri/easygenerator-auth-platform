import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProblemAlert } from './ProblemAlert';

describe('ProblemAlert', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down a Retry-After delay and announces the remaining wait', () => {
    vi.useFakeTimers();
    render(<ProblemAlert message="Too many attempts." retryAfter={2} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 2s.');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 1s.');
  });
});
