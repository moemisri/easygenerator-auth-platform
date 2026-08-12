import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

import { selectIntegrationExitStatus } from '../../../../scripts/run-integration-tests.mjs';

const runnerUrl = new URL(
  '../../../../scripts/run-integration-tests.mjs',
  import.meta.url,
);

it('imports without process or Docker side effects', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(runnerUrl.href)}); process.stdout.write('imported')`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    },
  );

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('imported');
});

it.each([
  {
    name: 'Vitest success survives cleanup failure',
    input: [0, true, 0, 17],
    expected: 0,
  },
  {
    name: 'Vitest failure survives cleanup failure',
    input: [0, true, 7, 17],
    expected: 7,
  },
  {
    name: 'setup failure governs before Vitest starts',
    input: [9, false, 1, 17],
    expected: 9,
  },
  {
    name: 'cleanup failure governs only without setup or Vitest failure',
    input: [0, false, 1, 17],
    expected: 17,
  },
])('$name', ({ input, expected }) => {
  expect(selectIntegrationExitStatus(...input)).toBe(expected);
});
