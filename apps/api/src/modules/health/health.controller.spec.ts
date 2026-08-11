import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports process liveness', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });
});
