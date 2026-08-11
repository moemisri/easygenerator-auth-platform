import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SafeUser } from '@easygenerator/contracts';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedPrincipal } from '../auth/session.service';
import { ApiUsersMe } from '../../platform/http/openapi';

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
