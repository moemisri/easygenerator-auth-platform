import { randomUUID } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';

export const WEB_ORIGIN = 'http://localhost:5173';
export const ADMIN = {
  email: 'task11-admin@example.test',
  name: 'Task 11 Administrator',
  password: 'Task11Admin1!',
} as const;

export interface TestIdentity {
  email: string;
  name: string;
  password: string;
}

export function uniqueIdentity(label: string): TestIdentity {
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  return {
    email: `${label}-${suffix}@example.test`,
    name: `${label} ${suffix}`,
    password: 'Task11User1!',
  };
}

export async function signUp(page: Page, identity: TestIdentity) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Name').fill(identity.name);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await Promise.all([
    page.waitForURL('**/app'),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
}

export async function signIn(page: Page, identity: TestIdentity) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await Promise.all([
    page.waitForURL('**/app'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

export async function createUser(
  browser: Browser,
  identity: TestIdentity,
): Promise<void> {
  const context = await browser.newContext();
  try {
    await signUp(await context.newPage(), identity);
  } finally {
    await context.close();
  }
}
