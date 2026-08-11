import { timingSafeEqual } from 'node:crypto';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from '../users/users.module';
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

const constantTimeDigestComparator: DigestComparator = (left, right) =>
  timingSafeEqual(left, right);

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    UsersModule,
  ],
  providers: [
    PasswordService,
    SessionRepository,
    SessionService,
    CsrfService,
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
  ],
  exports: [PasswordService, SessionService, CsrfService],
})
export class AuthModule {}
