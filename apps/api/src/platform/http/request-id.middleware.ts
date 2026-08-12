import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type RequestWithId = {
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: RequestWithId,
    response: HeaderResponse,
    next: () => void,
  ): void {
    const inbound = request.headers?.['x-request-id'];
    const requestId =
      typeof inbound === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        inbound,
      )
        ? inbound.toLowerCase()
        : randomUUID();
    request.id = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}
