import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  signinSchema,
  signupSchema,
  type AuthSessionResponse,
  type SigninInput,
  type SignupInput,
} from '@easygenerator/contracts';

import { AuthService } from './auth.service';
import { CookieService, type CookieResponse } from './cookie.service';
import { CsrfGuard } from './csrf.guard';
import { CsrfService } from './csrf.service';
import { CurrentPrincipal } from './current-principal.decorator';
import type { AuthenticatedHttpRequest } from './session.guard';
import { SessionGuard } from './session.guard';
import type { AuthenticatedPrincipal } from './session.service';

class SignupBody implements SignupInput {
  static readonly schema = signupSchema;
  email!: string;
  name!: string;
  password!: string;
}

class SigninBody implements SigninInput {
  static readonly schema = signinSchema;
  email!: string;
  password!: string;
}

@Controller('auth')
export class AuthController {
  private readonly assistantEnabled: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
    private readonly csrf: CsrfService,
    config: ConfigService,
  ) {
    this.assistantEnabled = config.getOrThrow<boolean>('ASSISTANT_ENABLED');
  }

  @Post('signup')
  @Header('Cache-Control', 'no-store')
  async signUp(
    @Body() body: SignupBody,
    @Req() request: AuthenticatedHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.signUp(body, {
      ip: request.ip,
      requestId: request.id,
    });
    this.cookies.set(response, result.rawSessionToken);
    return this.authResponse(result.user, result.rawSessionToken);
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async signIn(
    @Body() body: SigninBody,
    @Req() request: AuthenticatedHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.signIn(body, {
      ip: request.ip,
      requestId: request.id,
    });
    this.cookies.set(response, result.rawSessionToken);
    return this.authResponse(result.user, result.rawSessionToken);
  }

  @Get('session')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  session(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: AuthenticatedHttpRequest,
  ): AuthSessionResponse {
    const rawSessionToken = request.rawSessionToken;
    if (rawSessionToken === undefined) {
      throw new Error('SessionGuard did not attach a session token');
    }
    return this.authResponse(principal.user, rawSessionToken);
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: AuthenticatedHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    const rawSessionToken = request.rawSessionToken;
    if (rawSessionToken === undefined) {
      throw new Error('CsrfGuard did not attach a session token');
    }
    await this.auth.signOut(rawSessionToken, {
      ip: request.ip,
      requestId: request.id,
    });
    this.cookies.clear(response);
  }

  private authResponse(
    user: AuthSessionResponse['user'],
    rawSessionToken: string,
  ): AuthSessionResponse {
    return {
      user,
      csrfToken: this.csrf.issue(rawSessionToken),
      features: { assistant: this.assistantEnabled },
    };
  }
}
