import { describe, expect, it } from 'vitest';

import { AuditEventSchema } from './audit-event.schema';

describe('AuditEventSchema', () => {
  it('indexes chronological, actor, and target audit queries', () => {
    expect(AuditEventSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ createdAt: -1 }, {}],
        [{ actorId: 1, createdAt: -1 }, {}],
        [{ targetId: 1, createdAt: -1 }, {}],
      ]),
    );
  });
});
