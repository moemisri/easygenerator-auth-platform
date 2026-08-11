import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const runnerUrl = new URL('./run-integration-tests.mjs', import.meta.url);

function evaluateRunner(source) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const runner = await import(${JSON.stringify(runnerUrl.href)}); ${source}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    },
  );
}

test('importing the runner has no process or Docker side effects', () => {
  const result = evaluateRunner("process.stdout.write('imported')");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported');
});

for (const scenario of [
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
]) {
  test(scenario.name, () => {
    const result = evaluateRunner(
      `process.stdout.write(String(runner.selectIntegrationExitStatus(${scenario.input.join(', ')})))`,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, String(scenario.expected));
  });
}
