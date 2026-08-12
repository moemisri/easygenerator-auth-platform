import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SafeUser } from '@easygenerator/contracts';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedPrincipal } from '../auth/session.service.js';
import { ApiUsersMe } from '../../platform/http/openapi.js';

@Controller('users')
@ApiTags('Users')
export class UsersController {
  @Get('me')
  @ApiUsersMe()
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  me(@CurrentPrincipal() principal: AuthenticatedPrincipal): SafeUser {
    return principal.user;
  }
}
