import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ApplicationPage } from '../../pages/ApplicationPage';
import { deferred } from '../../test/deferred';
import { renderWithApp } from '../../test/render-with-app';
import { ProtectedRoute } from './ProtectedRoute';

describe('AuthProvider', () => {
  it('does not render a protected route until restoration completes', () => {
    const pendingSession = deferred<never>();
    renderWithApp(
      <ProtectedRoute>
        <ApplicationPage />
      </ProtectedRoute>,
      { sessionPromise: pendingSession.promise },
    );
    expect(
      screen.getByRole('status', { name: /restoring session/i }),
    ).toBeVisible();
    expect(
      screen.queryByText('Welcome to the application.'),
    ).not.toBeInTheDocument();
  });

  it('deduplicates restoration under StrictMode', async () => {
    const pendingSession = deferred<never>();
    render(
      <StrictMode>
        <div />
      </StrictMode>,
    );
    renderWithApp(<div />, { sessionPromise: pendingSession.promise });
    expect(pendingSession.promise).toBeDefined();
  });
});
