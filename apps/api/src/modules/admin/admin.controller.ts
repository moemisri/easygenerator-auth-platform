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
  adminUserIdParamsSchema,
  type AdminUserIdParams,
  adminUsersQuerySchema,
  type AdminUsersQuery,
  type SafeUser,
  updateAdminUserSchema,
  type UpdateUserInput,
  type UserPage,
} from '@easygenerator/contracts';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedHttpRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedPrincipal } from '../auth/session.service';
import { AdminMutationProtectionGuard } from './admin-mutation-protection.guard';
import { AdminService } from './admin.service';
import { RequireCapability } from './capability.decorator';
import { CapabilityGuard } from './capability.guard';
import {
  ApiAdminListUsers,
  ApiAdminUpdateUser,
} from '../../platform/http/openapi';

class AdminUsersQueryDto implements AdminUsersQuery {
  static readonly schema = adminUsersQuerySchema;
  page!: number;
  pageSize!: number;
  search?: string;
  sort!: AdminUsersQuery['sort'];
  direction!: AdminUsersQuery['direction'];
}

class AdminUserIdParamsDto implements AdminUserIdParams {
  static readonly schema = adminUserIdParamsSchema;
  id!: string;
}

class UpdateAdminUserBody implements UpdateUserInput {
  static readonly schema = updateAdminUserSchema;
  version!: number;
  role?: UpdateUserInput['role'];
  status?: UpdateUserInput['status'];
}

@Controller('admin/users')
@ApiTags('Administration')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiAdminListUsers()
  @UseGuards(SessionGuard, CapabilityGuard)
  @RequireCapability('READ_USERS')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: AdminUsersQueryDto): Promise<UserPage> {
    return this.admin.listUsers(query);
  }

  @Patch(':id')
  @ApiAdminUpdateUser()
  @UseGuards(
    SessionGuard,
    CsrfGuard,
    CapabilityGuard,
    AdminMutationProtectionGuard,
  )
  @RequireCapability('MANAGE_BASIC_USERS')
  @Header('Cache-Control', 'no-store')
  update(
    @Param() params: AdminUserIdParamsDto,
    @Body() body: UpdateAdminUserBody,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: AuthenticatedHttpRequest,
  ): Promise<SafeUser> {
    return this.admin.updateUser(principal.user, params.id, body, {
      requestId: request.id,
    });
  }
}
