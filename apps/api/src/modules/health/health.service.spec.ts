import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service';

const passingDependency = {
  ping: async () => ({ ok: 1 }),
};

const failingDependency = {
  ping: async () => Promise.reject(new Error('dependency unavailable')),
};

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('always reports process liveness without checking dependencies', () => {
    const service = new HealthService(failingDependency, failingDependency);

    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('reports readiness when MongoDB and Redis respond', async () => {
    const service = new HealthService(passingDependency, passingDependency);

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { mongodb: 'up', redis: 'up' },
    });
  });

  it('degrades readiness when only Redis fails', async () => {
    const service = new HealthService(passingDependency, failingDependency);

    await expect(service.ready()).resolves.toEqual({
      status: 'degraded',
      dependencies: { mongodb: 'up', redis: 'down' },
    });
  });

  it('marks the service unavailable when MongoDB fails', async () => {
    const service = new HealthService(failingDependency, passingDependency);

    await expect(service.ready()).resolves.toEqual({
      status: 'degraded',
      dependencies: { mongodb: 'down', redis: 'up' },
    });
  });

  it('bounds both dependency checks with concurrent one-second deadlines', async () => {
    vi.useFakeTimers();
    const neverResponds = { ping: () => new Promise<never>(() => undefined) };
    const service = new HealthService(neverResponds, neverResponds);

    const readiness = service.ready();
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void readiness.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(readiness).resolves.toEqual({
      status: 'degraded',
      dependencies: { mongodb: 'down', redis: 'down' },
    });
  });
});
