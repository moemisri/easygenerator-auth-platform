import { configSchema, type AppConfig } from './config.schema';

export function configuration(
  environment: Record<string, unknown> = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
