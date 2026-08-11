import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const sessionLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1000;

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

  constructor(config: ConfigService) {
    const isProduction =
      config.getOrThrow<'development' | 'test' | 'production'>('NODE_ENV') ===
      'production';
    this.cookieName = isProduction ? '__Host-session' : 'session';
    this.secure = isProduction;
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
      maxAge: sessionLifetimeMilliseconds,
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
