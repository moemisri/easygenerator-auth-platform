import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

export const APP_ORIGIN = Symbol('APP_ORIGIN');

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

type OriginRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_ORIGIN) private readonly allowedOrigin: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();
    if (safeMethods.has(request.method.toUpperCase())) return true;

    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin !== this.allowedOrigin) {
      throw new ForbiddenException('Request origin is not allowed');
    }

    return true;
  }
}
