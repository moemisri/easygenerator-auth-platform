import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { HealthService } from './health.service';
import { ApiHealthLive, ApiHealthReady } from '../../platform/http/openapi';

type StatusResponse = {
  status(code: number): unknown;
};

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiHealthLive()
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiHealthReady()
  async ready(@Res({ passthrough: true }) response: StatusResponse) {
    const readiness = await this.health.ready();
    if (readiness.dependencies.mongodb === 'down') {
      response.status(503);
    }
    return readiness;
  }
}
