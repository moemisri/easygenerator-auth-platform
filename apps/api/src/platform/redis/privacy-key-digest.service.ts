import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrivacyKeyDigestService {
  private readonly secret: Buffer;

  constructor(config: ConfigService) {
    this.secret = Buffer.from(
      config.getOrThrow<string>('IDENTITY_HASH_SECRET'),
      'base64',
    );
  }

  digest(scope: string, value: string): string {
    return createHmac('sha256', this.secret)
      .update(scope)
      .update('\0')
      .update(value)
      .digest('base64url');
  }
}
