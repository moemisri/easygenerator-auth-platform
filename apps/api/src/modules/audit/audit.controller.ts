import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  adminAuditEventsQuerySchema,
  type AdminAuditEventsQuery,
  type AuditEventPage,
} from '@easygenerator/contracts';
import { ApiTags } from '@nestjs/swagger';

import { CapabilityGuard } from '../admin/capability.guard';
import { RequireCapability } from '../admin/capability.decorator';
import { SessionGuard } from '../auth/session.guard';
import { AuditService } from './audit.service';
import { ApiAdminAuditEvents } from '../../platform/http/openapi';

class AdminAuditEventsQueryDto implements AdminAuditEventsQuery {
  static readonly schema = adminAuditEventsQuerySchema;
  page!: number;
  pageSize!: number;
}

@Controller('admin/audit-events')
@ApiTags('Administration')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiAdminAuditEvents()
  @UseGuards(SessionGuard, CapabilityGuard)
  @RequireCapability('READ_AUDIT')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: AdminAuditEventsQueryDto): Promise<AuditEventPage> {
    return this.audit.listSafe(query);
  }
}
