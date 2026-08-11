import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseIndexInitializer } from './database-index-initializer';

interface Deferred {
  promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
}

function deferred(): Deferred {
  let rejectPromise!: (error: Error) => void;
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function createInitializer() {
  const modelNames = ['User', 'Session', 'AuditEvent', 'SecurityState'];
  const initializations = new Map(
    modelNames.map((modelName) => [modelName, deferred()]),
  );
  const models = new Map(
    modelNames.map((modelName) => [
      modelName,
      {
        init: vi.fn(() => initializations.get(modelName)!.promise),
      },
    ]),
  );
  const model = vi.fn((modelName: string) => models.get(modelName));
  const initializer = new DatabaseIndexInitializer({
    model,
  } as unknown as Connection);

  return { initializer, initializations, model, models };
}

describe('DatabaseIndexInitializer', () => {
  it('waits for every explicitly named security-critical model initialization', async () => {
    const { initializer, initializations, model, models } = createInitializer();
    let settled = false;

    const gate = initializer.ensureSecurityCriticalIndexes().finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(model.mock.calls.map(([modelName]) => modelName)).toEqual([
      'User',
      'Session',
      'AuditEvent',
      'SecurityState',
    ]);
    for (const registeredModel of models.values()) {
      expect(registeredModel.init).toHaveBeenCalledOnce();
    }
    expect(settled).toBe(false);

    initializations.get('User')!.resolve();
    initializations.get('Session')!.resolve();
    initializations.get('AuditEvent')!.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    initializations.get('SecurityState')!.resolve();
    await expect(gate).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it('rejects readiness when a required model initialization fails', async () => {
    const { initializer, initializations } = createInitializer();
    const failure = new Error('unique index creation failed');

    const gate = initializer.ensureSecurityCriticalIndexes();
    initializations.get('AuditEvent')!.reject(failure);

    await expect(gate).rejects.toBe(failure);
  });
});
