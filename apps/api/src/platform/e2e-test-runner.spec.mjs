import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

import {
  normalizeForwardedArguments,
  selectE2eTermination,
} from '../../../../scripts/run-e2e.mjs';

const runnerUrl = new URL('../../../../scripts/run-e2e.mjs', import.meta.url);

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

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('imported');
});

it('preserves focused Playwright arguments and removes only the script separator', () => {
  expect(
    normalizeForwardedArguments([
      '--',
      'e2e/auth.spec.ts',
      '--grep',
      'required authentication journey',
    ]),
  ).toEqual(['e2e/auth.spec.ts', '--grep', 'required authentication journey']);
});

const success = { kind: 'exit', status: 0 };
const setupFailure = { kind: 'exit', status: 9 };
const playwrightFailure = { kind: 'exit', status: 7 };
const cleanupFailure = { kind: 'exit', status: 17 };

it('keeps Playwright authoritative after it starts, including on success', () => {
  expect(
    selectE2eTermination(success, true, playwrightFailure, cleanupFailure),
  ).toEqual(playwrightFailure);
  expect(selectE2eTermination(success, true, success, cleanupFailure)).toEqual(
    success,
  );
});

it('uses setup before Playwright and cleanup only when no primary command ran', () => {
  expect(
    selectE2eTermination(setupFailure, false, undefined, cleanupFailure),
  ).toEqual(setupFailure);
  expect(
    selectE2eTermination(success, false, undefined, cleanupFailure),
  ).toEqual(cleanupFailure);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  it(`preserves ${signal} through cleanup so the runner can re-signal itself`, () => {
    const signalled = { kind: 'signal', signal };

    expect(
      selectE2eTermination(success, true, signalled, cleanupFailure),
    ).toEqual(signalled);
    expect(
      selectE2eTermination(signalled, false, undefined, cleanupFailure),
    ).toEqual(signalled);
  });
}

function harnessSource({ setup, playwright, cleanup }) {
  return `
    const { applyE2eTermination, runE2ePlan } = await import(${JSON.stringify(runnerUrl.href)});
    const command = (source) => ({
      command: process.execPath,
      arguments: ['--input-type=module', '--eval', source],
    });
    const termination = await runE2ePlan({
      setup: [command(${JSON.stringify(setup)})],
      playwright: command(${JSON.stringify(playwright)}),
      cleanup: command(${JSON.stringify(cleanup)}),
    });
    applyE2eTermination(termination);
  `;
}

function spawnHarness(sources) {
  return import('node:child_process').then(({ spawn }) =>
    spawn(
      process.execPath,
      ['--input-type=module', '--eval', harnessSource(sources)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}

function completed(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('exit', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function waitForOutput(child, marker) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${marker}`)),
      5_000,
    );
    const onData = (chunk) => {
      if (!String(chunk).includes(marker)) return;
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
  });
}

it('preserves real subprocess status while cleanup cannot mask Playwright', async () => {
  const child = await spawnHarness({
    setup: 'process.exit(0)',
    playwright: 'process.exit(7)',
    cleanup: 'process.exit(17)',
  });

  await expect(completed(child)).resolves.toMatchObject({
    status: 7,
    signal: null,
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  it(`cleans up and re-signals itself when ${signal} arrives during cleanup`, async () => {
    const child = await spawnHarness({
      setup: 'process.exit(0)',
      playwright: 'process.exit(0)',
      cleanup:
        "process.stdout.write('cleanup-ready\\n'); setInterval(() => undefined, 1_000)",
    });
    const completion = completed(child);
    await waitForOutput(child, 'cleanup-ready');
    child.kill(signal);

    await expect(completion).resolves.toMatchObject({
      status: null,
      signal,
    });
  }, 10_000);
}

it('terminates the full Playwright process group before cleanup and leaves no descendant alive', async () => {
  const descendant = `
      process.on('SIGTERM', () => {
        process.stdout.write('descendant-stopped\\n');
        process.exit(0);
      });
      process.stdout.write('descendant-ready\\n');
      setInterval(() => undefined, 1_000);
    `;
  const playwright = `
      const { spawn } = await import('node:child_process');
      spawn(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(descendant)}], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      setInterval(() => undefined, 1_000);
    `;
  const child = await spawnHarness({
    setup: 'process.exit(0)',
    playwright,
    cleanup: "process.stdout.write('cleanup-complete\\n')",
  });
  const completion = completed(child);
  await waitForOutput(child, 'descendant-ready');
  child.kill('SIGTERM');

  await expect(completion).resolves.toMatchObject({
    status: null,
    signal: 'SIGTERM',
    stdout: expect.stringContaining('descendant-stopped'),
  });
  const result = await completion;
  expect(result.stdout).toContain('cleanup-complete');
}, 10_000);
