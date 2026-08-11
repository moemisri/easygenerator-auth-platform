import { Controller, Get, Res } from '@nestjs/common';

import { HealthService } from './health.service';

type StatusResponse = {
  status(code: number): unknown;
};

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: StatusResponse) {
    const readiness = await this.health.ready();
    if (readiness.dependencies.mongodb === 'down') {
      response.status(503);
    }
    return readiness;
  }
}
