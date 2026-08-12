import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';

import type { AppConfig } from '../config/config.schema.js';
import { registerSpaHosting } from './spa-fallback.js';

@Injectable()
export class SpaFallbackRegistrar implements OnModuleInit {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    // `bootstrap-admin` boots the same AppModule through
    // NestFactory.createApplicationContext, which has no HTTP adapter at all.
    // Static hosting is meaningless there, so skip rather than fail: touching
    // the absent adapter threw during module init, and because the CLI only
    // closes an application it managed to construct, the open Mongo sockets
    // then kept the process alive forever instead of exiting non-zero.
    const httpAdapter = this.httpAdapterHost?.httpAdapter as
      Parameters<typeof registerSpaHosting>[0] | undefined;
    if (httpAdapter === undefined || httpAdapter === null) {
      return;
    }

    registerSpaHosting(
      httpAdapter,
      this.config.get('SERVE_STATIC_ASSETS', { infer: true }),
    );
  }
}
