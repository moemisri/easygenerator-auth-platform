import { describe, expect, it } from 'vitest';

import { SpaFallbackRegistrar } from './spa-fallback.registrar.js';

type Config = { get: (key: string, options?: unknown) => unknown };
type AdapterHost = { httpAdapter?: unknown };

function registrar(config: Config, host: AdapterHost): SpaFallbackRegistrar {
  return new SpaFallbackRegistrar(config as never, host as never);
}

describe('SpaFallbackRegistrar', () => {
  const enabledConfig: Config = { get: () => true };

  // Regression: bootstrap-admin boots AppModule via createApplicationContext,
  // where HttpAdapterHost carries no adapter. Reaching into the absent adapter
  // threw inside onModuleInit, and the CLI's failure path leaves the process
  // hanging on open datastore handles rather than exiting, so the crash
  // presented as an indefinite hang in e2e setup.
  it('skips hosting when no HTTP adapter exists (CLI context)', () => {
    expect(() => registrar(enabledConfig, {}).onModuleInit()).not.toThrow();
  });

  it('skips hosting when the adapter host itself is absent', () => {
    expect(() =>
      registrar(
        enabledConfig,
        undefined as unknown as AdapterHost,
      ).onModuleInit(),
    ).not.toThrow();
  });

  it('registers hosting when an HTTP adapter is present', () => {
    const calls: string[] = [];
    const host: AdapterHost = {
      httpAdapter: {
        getInstance: () => ({ use: () => calls.push('use') }),
        useStaticAssets: () => calls.push('static'),
      },
    };

    registrar(enabledConfig, host).onModuleInit();

    expect(calls).toEqual(['static', 'use']);
  });

  it('registers nothing when static hosting is disabled', () => {
    const calls: string[] = [];
    const host: AdapterHost = {
      httpAdapter: {
        getInstance: () => ({ use: () => calls.push('use') }),
        useStaticAssets: () => calls.push('static'),
      },
    };

    registrar({ get: () => false }, host).onModuleInit();

    expect(calls).toEqual([]);
  });
});
