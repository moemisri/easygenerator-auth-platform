import { describe, expect, it } from 'vitest';

import {
  AUDIT_RETENTION_SECONDS,
  AuditEventSchema,
} from './audit-event.schema';

describe('AuditEventSchema', () => {
  it('keeps only the reader sort index and a bounded retention index', () => {
    expect(AUDIT_RETENTION_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(AuditEventSchema.indexes()).toEqual([
      [{ createdAt: -1, _id: -1 }, {}],
      [{ createdAt: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS }],
    ]);
  });
});
