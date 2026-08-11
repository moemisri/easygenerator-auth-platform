import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { Session } from './schemas/session.schema';

export interface NewSession {
  userId: string;
  tokenDigest: string;
  expiresAt: Date;
}

export interface StoredSession extends NewSession {
  id: string;
  revokedAt: Date | null;
}

interface SessionRecord extends Omit<StoredSession, 'id' | 'userId'> {
  _id: unknown;
  userId: unknown;
}

function mapStoredSession(session: SessionRecord): StoredSession {
  return {
    id: String(session._id),
    userId: String(session.userId),
    tokenDigest: session.tokenDigest,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
  };
}

@Injectable()
export class SessionRepository {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
  ) {}

  async create(
    session: NewSession,
    dbSession?: ClientSession,
  ): Promise<StoredSession> {
    const documents =
      dbSession === undefined
        ? await this.sessions.create([session])
        : await this.sessions.create([session], { session: dbSession });
    const document = documents[0];
    if (document === undefined) {
      throw new Error('Session creation returned no document');
    }
    return mapStoredSession(document.toObject() as SessionRecord);
  }

  async findByTokenDigest(tokenDigest: string): Promise<StoredSession | null> {
    const session = await this.sessions
      .findOne({ tokenDigest })
      .lean<SessionRecord>()
      .exec();
    return session === null ? null : mapStoredSession(session);
  }

  async revokeByTokenDigest(
    tokenDigest: string,
    revokedAt: Date,
    dbSession?: ClientSession,
  ): Promise<void> {
    await this.sessions
      .updateOne(
        { tokenDigest },
        { $set: { revokedAt } },
        dbSession === undefined ? {} : { session: dbSession },
      )
      .exec();
  }

  async revokeAllForUser(
    userId: string,
    revokedAt: Date,
    dbSession?: ClientSession,
  ): Promise<void> {
    await this.sessions
      .updateMany(
        { userId },
        { $set: { revokedAt } },
        dbSession === undefined ? {} : { session: dbSession },
      )
      .exec();
  }
}
