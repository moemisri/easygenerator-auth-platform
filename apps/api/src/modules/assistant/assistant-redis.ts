import type { ConfigService } from '@nestjs/config';

export function assistantRedisNamespace(config: ConfigService): string {
  const environment = config.getOrThrow<'development' | 'test' | 'production'>(
    'NODE_ENV',
  );
  return `easygenerator:${environment}:assistant`;
}
