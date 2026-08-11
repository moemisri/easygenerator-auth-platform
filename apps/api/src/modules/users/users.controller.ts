import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SafeUser } from '@easygenerator/contracts';

import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedPrincipal } from '../auth/session.service';

@Controller('users')
export class UsersController {
  @Get('me')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  me(@CurrentPrincipal() principal: AuthenticatedPrincipal): SafeUser {
    return principal.user;
  }
}
