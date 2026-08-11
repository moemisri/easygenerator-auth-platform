import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { DatabaseIndexInitializer } from './database-index-initializer';

export const DATABASE_HEALTH = Symbol('DATABASE_HEALTH');

export interface DependencyHealthAdapter {
  ping(): Promise<unknown>;
}

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        dbName: config.getOrThrow<string>('DB_NAME'),
        connectTimeoutMS: 1_000,
        serverSelectionTimeoutMS: 1_000,
      }),
    }),
  ],
  providers: [
    DatabaseIndexInitializer,
    {
      provide: DATABASE_HEALTH,
      inject: [getConnectionToken()],
      useFactory: (connection: Connection): DependencyHealthAdapter => ({
        ping: async () => {
          if (connection.db === undefined) {
            throw new Error('MongoDB is not connected');
          }
          return connection.db.admin().ping();
        },
      }),
    },
  ],
  exports: [DATABASE_HEALTH, DatabaseIndexInitializer],
})
export class DatabaseModule {}
