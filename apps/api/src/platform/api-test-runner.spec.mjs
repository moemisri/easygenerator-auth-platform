import { expect, it } from 'vitest';

import { interpretTestProcessResult } from '../../../../scripts/run-api-tests.mjs';

for (const status of [0, 7]) {
  it(`preserves numeric child exit status ${status}`, () => {
    expect(interpretTestProcessResult({ status, signal: null })).toEqual({
      kind: 'exit',
      status,
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  it(`preserves child signal ${signal}`, () => {
    expect(interpretTestProcessResult({ status: null, signal })).toEqual({
      kind: 'signal',
      signal,
    });
  });
}
