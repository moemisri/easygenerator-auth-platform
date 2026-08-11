import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';

export const redact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.csrfToken',
  'res.headers.set-cookie',
  '*.MONGODB_URI',
  '*.REDIS_URL',
  '*.GEMINI_API_KEY',
];

type LoggingConfig = {
  LOG_LEVEL: string;
  NODE_ENV: 'development' | 'test' | 'production';
};

type RequestWithId = IncomingMessage & { id?: string };

export function createPinoHttpOptions(config: LoggingConfig): Options {
  return {
    level: config.LOG_LEVEL,
    redact,
    genReqId: (request: IncomingMessage, response: ServerResponse) => {
      const requestId = (request as RequestWithId).id ?? randomUUID();
      response.setHeader('X-Request-Id', requestId);
      return requestId;
    },
    ...(config.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true },
          },
        }),
  };
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: createPinoHttpOptions({
          NODE_ENV: config.getOrThrow<LoggingConfig['NODE_ENV']>('NODE_ENV'),
          LOG_LEVEL: config.getOrThrow<string>('LOG_LEVEL'),
        }),
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggingModule {}
