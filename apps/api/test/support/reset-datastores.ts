import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';

import { REDIS } from '../../src/platform/redis/redis.constants';

const testRedisPattern = 'easygenerator:test:*';

async function clearTestRedisData(redis: Redis): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      testRedisPattern,
      'COUNT',
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) await redis.unlink(...keys);
  } while (cursor !== '0');
}

export async function resetDatastores(
  app: NestExpressApplication,
): Promise<void> {
  const connection = app.get<Connection>(getConnectionToken());
  if (connection.name !== 'easygenerator_auth_test') {
    throw new Error(`Refusing to reset database ${connection.name}`);
  }

  await Promise.all(
    Object.values(connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  await clearTestRedisData(app.get<Redis>(REDIS));
}
