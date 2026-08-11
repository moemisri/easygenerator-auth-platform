import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';

import { renderWithApp } from '../../test/render-with-app';
import { SignUpForm } from './SignUpForm';

describe('SignUpForm', () => {
  it('shows each password rule and signs up into the application', async () => {
    const user = userEvent.setup();
    renderWithApp(<SignUpForm />);
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^name/i), 'Ada');
    await user.type(screen.getByLabelText(/^password$/i), 'Secure1!');
    expect(screen.getByText(/at least 8 characters/i)).toHaveAttribute(
      'data-met',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(
      await screen.findByText('Welcome to the application.'),
    ).toBeVisible();
  });

  it('exposes schema validation descriptions for invalid email and name', async () => {
    const user = userEvent.setup();
    renderWithApp(<SignUpForm />);
    await user.type(screen.getByLabelText(/email/i), 'no');
    await user.type(screen.getByLabelText(/^name/i), 'A');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/valid email/i)).toBeVisible();
    expect(screen.getByText(/at least 3 characters/i)).toBeVisible();
  });
});
