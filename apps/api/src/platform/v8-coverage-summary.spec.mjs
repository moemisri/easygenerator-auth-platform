import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { summarizeV8Coverage } from '../../../../scripts/summarize-v8-coverage.mjs';

describe('V8 coverage summary', () => {
  it('summarizes measured source functions and ignores dependencies', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-v8-'));
    try {
      fs.writeFileSync(
        path.join(directory, 'coverage.json'),
        JSON.stringify({
          result: [
            {
              url: 'file:///repo/apps/api/src/main.ts',
              functions: [
                { ranges: [{ count: 1 }] },
                { ranges: [{ count: 0 }] },
              ],
            },
            {
              url: 'node:internal/fs',
              functions: [{ ranges: [{ count: 1 }] }],
            },
          ],
        }),
      );
      expect(summarizeV8Coverage(directory)).toContain(
        '| 1 | 1 | 2 | 50.00% |',
      );
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('fails closed on missing or source-empty coverage', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-v8-'));
    try {
      expect(() => summarizeV8Coverage(directory)).toThrow(
        'COVERAGE_REPORTS_MISSING',
      );
      fs.writeFileSync(path.join(directory, 'coverage.json'), '{"result":[]}');
      expect(() => summarizeV8Coverage(directory)).toThrow(
        'COVERAGE_REPORTS_EMPTY',
      );
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
});
