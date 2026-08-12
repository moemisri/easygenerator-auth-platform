import { describe, expect, it } from 'vitest';

import { hasExpectedProcessTree } from '../../../../scripts/production-image-process-tree.mjs';

describe('production image process-tree proof', () => {
  it('accepts Node process titles while requiring Node to be a direct tini child', () => {
    expect(
      hasExpectedProcessTree(`PID PPID COMMAND COMMAND
1159551 1159528 tini /usr/bin/tini -- node --eval setInterval(() => {}, 1000)
1159565 1159551 MainThread node --eval setInterval(() => {}, 1000)`),
    ).toBe(true);
    expect(
      hasExpectedProcessTree(`PID PPID COMMAND COMMAND
42 1 tini /usr/bin/tini -- node --eval setInterval(() => {}, 1000)
43 42 node node --eval setInterval(() => {}, 1000)`),
    ).toBe(true);
    expect(
      hasExpectedProcessTree(`PID PPID COMMAND COMMAND
1159551 1159528 tini /usr/bin/tini -- node --eval setInterval(() => {}, 1000)
1159565 999999 MainThread node --eval setInterval(() => {}, 1000)`),
    ).toBe(false);
  });
});
