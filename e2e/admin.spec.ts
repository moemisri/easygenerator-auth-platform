import { expect, test } from '@playwright/test';

import {
  ADMIN,
  WEB_ORIGIN,
  createUser,
  signIn,
  uniqueIdentity,
} from './fixtures';

test('administrator updates a user and a manager cannot promote to ADMIN', async ({
  browser,
  page,
}) => {
  const target = uniqueIdentity('managed-user');
  const manager = uniqueIdentity('manager-user');
  await createUser(browser, target);
  await createUser(browser, manager);

  await signIn(page, ADMIN);
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(
    page.getByRole('heading', { name: 'Administration', exact: true }),
  ).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search users' });
  await search.fill(target.email);
  const targetRow = page.getByRole('row').filter({ hasText: target.email });
  await expect(targetRow).toBeVisible();
  await targetRow
    .getByLabel(`New role for ${target.name}`)
    .selectOption('SUPPORT');
  await targetRow
    .getByRole('button', { name: `Change ${target.name}'s role` })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Change role' })
    .click();
  await expect(targetRow).toContainText('SUPPORT');

  const auditRegion = page.getByRole('region', {
    name: 'Recent audit events',
  });
  await expect(auditRegion).toContainText(
    'A user role changed from USER to SUPPORT.',
  );
  await expect(auditRegion).not.toContainText(target.email);

  await search.fill(manager.email);
  const managerRow = page.getByRole('row').filter({ hasText: manager.email });
  await expect(managerRow).toBeVisible();
  await managerRow
    .getByLabel(`New role for ${manager.name}`)
    .selectOption('MANAGER');
  await managerRow
    .getByRole('button', { name: `Change ${manager.name}'s role` })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Change role' })
    .click();
  await expect(managerRow).toContainText('MANAGER');

  const managerContext = await browser.newContext();
  try {
    const managerPage = await managerContext.newPage();
    await signIn(managerPage, manager);
    await managerPage.goto('/admin');
    const managerSearch = managerPage.getByRole('searchbox', {
      name: 'Search users',
    });
    await managerSearch.fill(target.email);
    const managerTargetRow = managerPage
      .getByRole('row')
      .filter({ hasText: target.email });
    await expect(managerTargetRow).toBeVisible();

    const managerRoleSelect = managerTargetRow.getByLabel(
      `New role for ${target.name}`,
    );
    await expect(
      managerRoleSelect.getByRole('option', { name: 'ADMIN' }),
    ).toHaveCount(0);

    const sessionResponse = await managerContext.request.get(
      `${WEB_ORIGIN}/api/v1/auth/session`,
    );
    expect(sessionResponse.ok()).toBe(true);
    const session = (await sessionResponse.json()) as { csrfToken: string };
    const usersResponse = await managerContext.request.get(
      `${WEB_ORIGIN}/api/v1/admin/users?search=${encodeURIComponent(target.email)}`,
    );
    expect(usersResponse.ok()).toBe(true);
    const users = (await usersResponse.json()) as {
      items: Array<{ id: string; version: number }>;
    };
    expect(users.items).toHaveLength(1);

    const forbidden = await managerContext.request.patch(
      `${WEB_ORIGIN}/api/v1/admin/users/${users.items[0]!.id}`,
      {
        headers: {
          Origin: WEB_ORIGIN,
          'X-CSRF-Token': session.csrfToken,
        },
        data: { version: users.items[0]!.version, role: 'ADMIN' },
      },
    );
    expect(forbidden.status()).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      code: 'TARGET_UPDATE_FORBIDDEN',
      status: 403,
    });
  } finally {
    await managerContext.close();
  }
});
