import { configSchema, type AppConfig } from './config.schema.js';

export function configuration(
  environment: Record<string, unknown> = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
