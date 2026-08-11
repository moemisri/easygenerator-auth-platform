import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

const securityCriticalModelNames = [
  'User',
  'Session',
  'AuditEvent',
  'SecurityState',
] as const;

@Injectable()
export class DatabaseIndexInitializer {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async ensureSecurityCriticalIndexes(): Promise<void> {
    await Promise.all(
      securityCriticalModelNames.map((modelName) =>
        this.connection.model(modelName).init(),
      ),
    );
  }
}
