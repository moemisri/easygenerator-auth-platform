import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_HEALTH,
  type DependencyHealthAdapter,
} from '../../platform/database/database.module';
import { REDIS } from '../../platform/redis/redis.constants';

const dependencyDeadlineMs = 1_000;

type DependencyState = 'up' | 'down';

function checkWithDeadline(
  operation: () => Promise<unknown>,
): Promise<DependencyState> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (state: DependencyState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(state);
    };
    const timeout = setTimeout(() => settle('down'), dependencyDeadlineMs);

    void operation().then(
      () => settle('up'),
      () => settle('down'),
    );
  });
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_HEALTH)
    private readonly mongodb: DependencyHealthAdapter,
    @Inject(REDIS)
    private readonly redis: DependencyHealthAdapter,
  ) {}

  live() {
    return { status: 'ok' as const };
  }

  async ready() {
    const [mongodb, redis] = await Promise.all([
      checkWithDeadline(() => this.mongodb.ping()),
      checkWithDeadline(() => this.redis.ping()),
    ]);

    return {
      status:
        mongodb === 'up' && redis === 'up'
          ? ('ok' as const)
          : ('degraded' as const),
      dependencies: { mongodb, redis },
    };
  }
}
