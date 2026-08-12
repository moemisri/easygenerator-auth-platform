import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenView(): never {
  throw new Error('Sensitive rendering detail');
}

afterEach(() => vi.restoreAllMocks());

describe('AppErrorBoundary', () => {
  it('replaces an unexpected render failure with a safe recovery screen', async () => {
    const reload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary onReload={reload}>
        <BrokenView />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(
      screen.queryByText('Sensitive rendering detail'),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Reload application' }),
    );
    expect(reload).toHaveBeenCalledOnce();
  });
});
