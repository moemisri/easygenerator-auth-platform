import { randomBytes, timingSafeEqual } from 'node:crypto';

import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { RateLimiterService } from '../../platform/redis/rate-limiter.service';
import { RedisModule } from '../../platform/redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DUMMY_PASSWORD_HASH, IDENTITY_HASH_SECRET } from './auth.constants';
import { CookieService } from './cookie.service';
import { CsrfGuard } from './csrf.guard';
import {
  CSRF_DIGEST_COMPARATOR,
  CSRF_SECRET,
  CsrfService,
  type DigestComparator,
} from './csrf.service';
import { PasswordService } from './password.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { SessionRepository } from './session.repository';
import {
  AUTH_CLOCK,
  cryptographicRandomSource,
  SESSION_RANDOM_SOURCE,
  SessionService,
  systemClock,
} from './session.service';
import { SessionGuard } from './session.guard';

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
    RateLimiterService,
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
      provide: IDENTITY_HASH_SECRET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Buffer.from(
          config.getOrThrow<string>('IDENTITY_HASH_SECRET'),
          'base64',
        ),
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
    RateLimiterService,
  ],
})
export class AuthModule {}
