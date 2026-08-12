import { expect, test } from '@playwright/test';

import { signUp, uniqueIdentity } from './fixtures';

test('direct assistant navigation provides a safe disabled state', async ({
  page,
}) => {
  // The identity has to be created before it can be used; signing in with a
  // freshly generated one only exercised the invalid-credentials path.
  await signUp(page, uniqueIdentity('assistant-disabled'));

  await page.goto('/assistant');

  await expect(
    page.getByRole('heading', {
      name: 'The assistant is not enabled for this environment.',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('You can continue using the rest of the application.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question' })).toHaveCount(0);
});
