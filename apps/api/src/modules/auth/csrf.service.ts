import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

export const CSRF_SECRET = Symbol('CSRF_SECRET');
export const CSRF_DIGEST_COMPARATOR = Symbol('CSRF_DIGEST_COMPARATOR');

export type DigestComparator = (left: Buffer, right: Buffer) => boolean;

@Injectable()
export class CsrfService {
  constructor(
    @Inject(CSRF_SECRET) private readonly secret: Buffer,
    @Inject(CSRF_DIGEST_COMPARATOR)
    private readonly compare: DigestComparator,
  ) {}

  issue(rawSessionToken: string): string {
    return createHmac('sha256', this.secret)
      .update(rawSessionToken)
      .digest('base64url');
  }

  verify(rawSessionToken: string, csrfToken: string): boolean {
    const expected = Buffer.from(this.issue(rawSessionToken));
    const received = Buffer.from(csrfToken);
    return (
      expected.length === received.length && this.compare(expected, received)
    );
  }
}
