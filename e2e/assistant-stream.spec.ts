import { expect, test, type Page, type Response } from '@playwright/test';

import { signUp, uniqueIdentity } from './fixtures';

const assistantChatPath = '/api/v1/assistant/chat';

function nextAssistantResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === assistantChatPath,
  );
}

function retrievalNeutralNonce(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(2).padStart(8, '0').replaceAll('0', '!').replaceAll('1', '?'),
  ).join('');
}

function expectEventStreamHeaders(response: Response) {
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['content-type']).toContain('text/event-stream');
  expect(headers['cache-control']).toBe('no-store, no-transform');
  expect(headers['x-accel-buffering']).toBe('no');
}

test('streams a real assistant completion and recovers from a terminal provider error', async ({
  page,
}, testInfo) => {
  await signUp(page, uniqueIdentity('assistant-stream'));
  await page.goto('/assistant');

  const question = page.getByRole('textbox', { name: 'Question' });
  await expect(question).toBeVisible();
  await question.fill('How are sessions protected?');
  const completedResponse = nextAssistantResponse(page);
  await page.getByRole('button', { name: 'Ask assistant' }).click();
  expectEventStreamHeaders(await completedResponse);
  await expect(
    page.getByRole('article', {
      name: 'Assistant answer to: How are sessions protected?',
    }),
  ).toContainText('Sessions use protected cookies.');
  await expect(page.getByRole('region', { name: 'Sources' })).toContainText(
    'Sessions',
  );
  await expect(page.getByRole('status')).toContainText('Answer complete.');

  for (const sequence of [1, 2]) {
    const nonce = retrievalNeutralNonce(
      `${testInfo.testId}:${testInfo.retry}:${sequence}`,
    );
    const providerFailureQuestion = `How does the assistant choose its sources? [${nonce}]`;
    await question.fill(providerFailureQuestion);
    const failedResponse = nextAssistantResponse(page);
    await page.getByRole('button', { name: 'Ask assistant' }).click();
    expectEventStreamHeaders(await failedResponse);
    await expect(
      page.getByText(
        'The assistant is temporarily unavailable. Please try again.',
      ),
    ).toBeVisible();

    const retriedResponse = nextAssistantResponse(page);
    await page.getByRole('button', { name: 'Retry question' }).click();
    expectEventStreamHeaders(await retriedResponse);
    await expect(
      page.getByRole('article', {
        name: `Assistant answer to: ${providerFailureQuestion}`,
      }),
    ).toContainText('The assistant selects public documentation sources.');
    await expect(page.getByRole('status')).toContainText('Answer complete.');
  }
});
