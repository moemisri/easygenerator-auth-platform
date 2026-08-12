import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../platform/database/database.module.js';
import { RedisModule } from '../../platform/redis/redis.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
