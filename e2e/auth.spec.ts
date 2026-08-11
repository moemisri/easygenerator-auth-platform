import { expect, test } from '@playwright/test';

import { signIn, signUp, uniqueIdentity } from './fixtures';

test('required authentication journey', async ({ page }) => {
  const user = uniqueIdentity('auth-user');

  await signUp(page, user);
  await expect(
    page.getByRole('heading', { name: 'Welcome to the application.' }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Welcome to the application.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/signin$/);

  await signIn(page, user);
  await expect(page.getByText(user.email)).toBeVisible();

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/access-denied$/);
  await expect(
    page.getByRole('heading', { name: 'Access denied' }),
  ).toBeVisible();
});
