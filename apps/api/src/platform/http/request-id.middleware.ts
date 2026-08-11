import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type RequestWithId = {
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
    const requestId = randomUUID();
    request.id = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}
