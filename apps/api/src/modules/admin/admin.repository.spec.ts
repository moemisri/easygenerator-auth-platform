import type { ClientSession, Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import { AdminRepository } from './admin.repository';
import type { SecurityState } from './schemas/security-state.schema';

describe('AdminRepository', () => {
  it('increments the singleton security revision inside the transaction', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const exec = vi.fn().mockResolvedValue(undefined);
    const findOneAndUpdate = vi.fn(() => ({ exec }));
    const repository = new AdminRepository({
      findOneAndUpdate,
    } as unknown as Model<SecurityState>);

    await repository.incrementSecurityRevision(dbSession);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'authorization' },
      {
        $inc: { revision: 1 },
        $setOnInsert: { key: 'authorization' },
      },
      { session: dbSession, upsert: true },
    );
    expect(exec).toHaveBeenCalledOnce();
  });
});
