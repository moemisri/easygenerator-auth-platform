import { z } from 'zod';

export const defaults = {
  PORT: 3000,
  DB_NAME: 'easygenerator_auth',
  SESSION_TTL_SECONDS: 604800,
  COOKIE_SECURE: false,
  ASSISTANT_ENABLED: false,
} as const;

const developmentDefaults = {
  APP_ORIGIN: 'http://localhost:5173',
  CSRF_SECRET: Buffer.alloc(32, 1).toString('base64'),
  IDENTITY_HASH_SECRET: Buffer.alloc(32, 2).toString('base64'),
  LOG_LEVEL: 'debug' as const,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/easygenerator_auth',
  REDIS_URL: 'redis://127.0.0.1:6379',
  TRUST_PROXY_HOPS: 0,
} as const;

const renderHostnamePattern =
  /^(?:[a-z0-9]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9]))\.onrender\.com$/;
const strictBase64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const integerFromEnvironment = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    z.number().int().min(minimum).max(maximum),
  );

const uriWithProtocol = (protocols: readonly string[]) =>
  z.url().refine((value) => protocols.includes(new URL(value).protocol), {
    message: `URL protocol must be one of: ${protocols.join(', ')}`,
  });

const httpsOrigin = z.url().transform((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    context.addIssue({
      code: 'custom',
      message:
        'APP_ORIGIN must be an HTTPS origin without credentials or a path',
    });
    return z.NEVER;
  }

  return url.origin;
});

const base64Secret = z
  .string()
  .min(1)
  .refine(
    (value) =>
      strictBase64Pattern.test(value) &&
      Buffer.from(value, 'base64').length >= 32,
    'Secret must contain at least 32 bytes of valid base64-decoded data',
  );

const rawConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: integerFromEnvironment(1, 65_535).optional(),
    MONGODB_URI: uriWithProtocol(['mongodb:', 'mongodb+srv:']).optional(),
    DB_NAME: z.literal(defaults.DB_NAME).optional(),
    REDIS_URL: uriWithProtocol(['redis:', 'rediss:']).optional(),
    CSRF_SECRET: base64Secret.optional(),
    IDENTITY_HASH_SECRET: base64Secret.optional(),
    TRUST_PROXY_HOPS: integerFromEnvironment(0, 10).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional(),
    APP_ORIGIN: httpsOrigin.optional(),
    RENDER_EXTERNAL_HOSTNAME: z.string().min(1).optional(),
    SESSION_TTL_SECONDS: integerFromEnvironment(60, 31_536_000).optional(),
    COOKIE_SECURE: booleanFromEnvironment.optional(),
    ASSISTANT_ENABLED: booleanFromEnvironment.optional(),
    GEMINI_API_KEY: z.string().trim().min(1).optional(),
    GEMINI_MODEL: z.string().trim().min(1).optional(),
    ASSISTANT_CORPUS_PATH: z.literal('docs/assistant-public').optional(),
  })
  .passthrough()
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production') {
      const required = [
        'MONGODB_URI',
        'DB_NAME',
        'REDIS_URL',
        'CSRF_SECRET',
        'IDENTITY_HASH_SECRET',
        'TRUST_PROXY_HOPS',
        'LOG_LEVEL',
      ] as const;

      for (const field of required) {
        if (config[field] === undefined) {
          context.addIssue({
            code: 'custom',
            message: `${field} is required in production`,
            path: [field],
          });
        }
      }

      if (config.COOKIE_SECURE === false) {
        context.addIssue({
          code: 'custom',
          message: 'COOKIE_SECURE cannot be false in production',
          path: ['COOKIE_SECURE'],
        });
      }

      if (
        config.APP_ORIGIN === undefined &&
        (config.RENDER_EXTERNAL_HOSTNAME === undefined ||
          !renderHostnamePattern.test(config.RENDER_EXTERNAL_HOSTNAME))
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Production requires APP_ORIGIN or a validated RENDER_EXTERNAL_HOSTNAME',
          path: ['APP_ORIGIN'],
        });
      }
    }

    if (
      config.RENDER_EXTERNAL_HOSTNAME !== undefined &&
      !renderHostnamePattern.test(config.RENDER_EXTERNAL_HOSTNAME)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'RENDER_EXTERNAL_HOSTNAME is not a valid Render hostname',
        path: ['RENDER_EXTERNAL_HOSTNAME'],
      });
    }

    if (config.ASSISTANT_ENABLED === true) {
      for (const field of ['GEMINI_API_KEY', 'GEMINI_MODEL'] as const) {
        if (config[field] === undefined) {
          context.addIssue({
            code: 'custom',
            message: `${field} is required when the assistant is enabled`,
            path: [field],
          });
        }
      }
    }
  })
  .transform((config) => {
    const isProduction = config.NODE_ENV === 'production';
    const renderOrigin = config.RENDER_EXTERNAL_HOSTNAME
      ? `https://${config.RENDER_EXTERNAL_HOSTNAME}`
      : undefined;

    return {
      NODE_ENV: config.NODE_ENV,
      PORT: config.PORT ?? defaults.PORT,
      MONGODB_URI: config.MONGODB_URI ?? developmentDefaults.MONGODB_URI,
      DB_NAME: config.DB_NAME ?? defaults.DB_NAME,
      REDIS_URL: config.REDIS_URL ?? developmentDefaults.REDIS_URL,
      CSRF_SECRET: config.CSRF_SECRET ?? developmentDefaults.CSRF_SECRET,
      IDENTITY_HASH_SECRET:
        config.IDENTITY_HASH_SECRET ?? developmentDefaults.IDENTITY_HASH_SECRET,
      TRUST_PROXY_HOPS:
        config.TRUST_PROXY_HOPS ?? developmentDefaults.TRUST_PROXY_HOPS,
      LOG_LEVEL: config.LOG_LEVEL ?? developmentDefaults.LOG_LEVEL,
      APP_ORIGIN:
        config.APP_ORIGIN ?? renderOrigin ?? developmentDefaults.APP_ORIGIN,
      SESSION_TTL_SECONDS:
        config.SESSION_TTL_SECONDS ?? defaults.SESSION_TTL_SECONDS,
      COOKIE_SECURE:
        config.COOKIE_SECURE ?? (isProduction ? true : defaults.COOKIE_SECURE),
      ASSISTANT_ENABLED: config.ASSISTANT_ENABLED ?? defaults.ASSISTANT_ENABLED,
      GEMINI_API_KEY: config.GEMINI_API_KEY,
      GEMINI_MODEL: config.GEMINI_MODEL,
      ASSISTANT_CORPUS_PATH:
        config.ASSISTANT_CORPUS_PATH ?? 'docs/assistant-public',
    };
  });

export const configSchema = rawConfigSchema;
export type AppConfig = z.output<typeof configSchema>;
