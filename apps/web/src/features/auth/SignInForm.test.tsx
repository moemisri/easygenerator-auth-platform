import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';

import { renderWithApp } from '../../test/render-with-app';
import { SignInForm } from './SignInForm';

describe('SignInForm', () => {
  it('submits with the keyboard and focuses a generic problem alert on failure', async () => {
    const user = userEvent.setup();
    renderWithApp(<SignInForm />);
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Secure1!{enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent(/check your email and password/i);
  });

  it('preserves the password and focus when visibility is toggled', async () => {
    const user = userEvent.setup();
    renderWithApp(<SignInForm />);
    const password = screen.getByLabelText(/^password$/i);
    await user.type(password, 'Secure1!');
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(password).toHaveValue('Secure1!');
    expect(
      screen.getByRole('button', { name: /hide password/i }),
    ).toHaveFocus();
  });
});
