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

  it('shows every password rule and rejects a password longer than 128 characters', async () => {
    const user = userEvent.setup();
    renderWithApp(<SignUpForm />);
    const password = screen.getByLabelText(/^password$/i);
    const rules = [
      'At least 8 characters',
      'At most 128 characters',
      'One letter',
      'One number',
      'One special character',
    ];
    await user.type(password, `A1!${'a'.repeat(125)}`);
    for (const rule of rules) {
      expect(screen.getByText(rule)).toHaveAttribute('data-met', 'true');
    }
    await user.type(password, 'a');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(
      await screen.findByText('Use at most 128 characters.'),
    ).toBeVisible();
  });

  it('keeps the visibility toggle separate from the label and describes password requirements', () => {
    renderWithApp(<SignUpForm />);
    const password = screen.getByLabelText(/^password$/i);
    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle.closest('label')).toBeNull();
    expect(toggle).toHaveClass('password-toggle');
    expect(password).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('password-requirements'),
    );
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
