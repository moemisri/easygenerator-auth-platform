import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminUsersQuerySchema,
  type AdminUsersQuery,
  type SafeUser,
  updateAdminUserSchema,
  type UpdateUserInput,
  type UserPage,
} from '@easygenerator/contracts';

import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedHttpRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedPrincipal } from '../auth/session.service';
import { AdminService } from './admin.service';
import { RequireCapability } from './capability.decorator';
import { CapabilityGuard } from './capability.guard';

class AdminUsersQueryDto implements AdminUsersQuery {
  static readonly schema = adminUsersQuerySchema;
  page!: number;
  pageSize!: number;
  search?: string;
  sort!: AdminUsersQuery['sort'];
  direction!: AdminUsersQuery['direction'];
}

class UpdateAdminUserBody implements UpdateUserInput {
  static readonly schema = updateAdminUserSchema;
  version!: number;
  role?: UpdateUserInput['role'];
  status?: UpdateUserInput['status'];
}

@Controller('admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @UseGuards(SessionGuard, CapabilityGuard)
  @RequireCapability('READ_USERS')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: AdminUsersQueryDto): Promise<UserPage> {
    return this.admin.listUsers(query);
  }

  @Patch(':id')
  @UseGuards(SessionGuard, CsrfGuard, CapabilityGuard)
  @RequireCapability('MANAGE_BASIC_USERS')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('id') targetId: string,
    @Body() body: UpdateAdminUserBody,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: AuthenticatedHttpRequest,
  ): Promise<SafeUser> {
    return this.admin.updateUser(principal.user, targetId, body, {
      requestId: request.id,
    });
  }
}
