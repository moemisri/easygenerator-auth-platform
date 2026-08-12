import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { summarizeUnitTests } from '../../../../scripts/summarize-unit-tests.mjs';

describe('unit test report summary', () => {
  it('aggregates exactly three measured JUnit reports', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-junit-'));
    try {
      for (const [name, tests, failures] of [
        ['contracts', 10, 0],
        ['api', 20, 1],
        ['web', 30, 0],
      ]) {
        fs.writeFileSync(
          path.join(directory, `${name}.xml`),
          `<testsuites tests="${tests}" failures="${failures}" errors="0" skipped="2"></testsuites>`,
        );
      }
      expect(summarizeUnitTests(directory)).toContain('| 60 | 1 | 0 | 6 |');
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('fails closed on missing or empty reports', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-junit-'));
    try {
      expect(() => summarizeUnitTests(directory)).toThrow(
        'UNIT_REPORTS_MISSING',
      );
      for (const name of ['contracts', 'api', 'web']) {
        fs.writeFileSync(
          path.join(directory, `${name}.xml`),
          '<testsuites tests="0"></testsuites>',
        );
      }
      expect(() => summarizeUnitTests(directory)).toThrow('UNIT_REPORTS_EMPTY');
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
});
