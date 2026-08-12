import { randomBytes, timingSafeEqual } from 'node:crypto';

import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditModule } from '../audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { RedisModule } from '../../platform/redis/redis.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DUMMY_PASSWORD_HASH } from './auth.constants.js';
import { CookieService } from './cookie.service.js';
import { CsrfGuard } from './csrf.guard.js';
import {
  CSRF_DIGEST_COMPARATOR,
  CSRF_SECRET,
  CsrfService,
  type DigestComparator,
} from './csrf.service.js';
import { PasswordService } from './password.service.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { SessionRepository } from './session.repository.js';
import {
  AUTH_CLOCK,
  cryptographicRandomSource,
  SESSION_RANDOM_SOURCE,
  SessionService,
  systemClock,
} from './session.service.js';
import { SessionGuard } from './session.guard.js';

const constantTimeDigestComparator: DigestComparator = (left, right) =>
  timingSafeEqual(left, right);

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    AuditModule,
    RedisModule,
    forwardRef(() => UsersModule),
  ],
  providers: [
    AuthService,
    PasswordService,
    SessionRepository,
    SessionService,
    CsrfService,
    CookieService,
    SessionGuard,
    CsrfGuard,
    { provide: AUTH_CLOCK, useValue: systemClock },
    { provide: SESSION_RANDOM_SOURCE, useValue: cryptographicRandomSource },
    {
      provide: CSRF_SECRET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Buffer.from(config.getOrThrow<string>('CSRF_SECRET'), 'base64'),
    },
    {
      provide: CSRF_DIGEST_COMPARATOR,
      useValue: constantTimeDigestComparator,
    },
    {
      provide: DUMMY_PASSWORD_HASH,
      inject: [PasswordService],
      useFactory: (passwords: PasswordService) =>
        passwords.hash(randomBytes(32).toString('base64url')),
    },
  ],
  controllers: [AuthController],
  exports: [
    PasswordService,
    SessionService,
    CsrfService,
    CookieService,
    SessionGuard,
    CsrfGuard,
  ],
})
export class AuthModule {}
