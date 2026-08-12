import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type SameSite = 'strict';

interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: SameSite;
  path: '/';
  maxAge: number;
}

interface ClearCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: SameSite;
  path: '/';
}

export interface CookieResponse {
  cookie(name: string, value: string, options: CookieOptions): unknown;
  clearCookie(name: string, options: ClearCookieOptions): unknown;
}

@Injectable()
export class CookieService {
  private readonly cookieName: '__Host-session' | 'session';
  private readonly secure: boolean;
  private readonly sessionLifetimeMilliseconds: number;

  constructor(config: ConfigService) {
    this.secure = config.getOrThrow<boolean>('COOKIE_SECURE');
    this.cookieName = this.secure ? '__Host-session' : 'session';
    this.sessionLifetimeMilliseconds =
      config.getOrThrow<number>('SESSION_TTL_SECONDS') * 1_000;
  }

  read(cookies: Record<string, string | undefined> | undefined): string | null {
    const token = cookies?.[this.cookieName];
    return typeof token === 'string' && token.length > 0 ? token : null;
  }

  set(response: CookieResponse, rawToken: string): void {
    response.cookie(this.cookieName, rawToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
      maxAge: this.sessionLifetimeMilliseconds,
    });
  }

  clear(response: CookieResponse): void {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
    });
  }
}
