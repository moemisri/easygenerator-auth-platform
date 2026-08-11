import {
  problemDetailsSchema,
  type ProblemDetails,
} from '@easygenerator/contracts';
import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AppError } from './app-error';

const problemTypeBase = 'https://easygenerator.com/problems';
export const PROBLEM_LOGGER = Symbol('PROBLEM_LOGGER');

export interface ProblemLogger {
  error(context: object, message: string): void;
}

function validatedProblem(problem: ProblemDetails): ProblemDetails {
  return problemDetailsSchema.parse(problem);
}

function titleForStatus(status: number): string {
  const title = HttpStatus[status];
  return typeof title === 'string' ? title.replaceAll('_', ' ') : 'Error';
}

export function mapProblem(
  exception: unknown,
  requestId: string,
  instance?: string,
): ProblemDetails {
  if (exception instanceof AppError) {
    return validatedProblem({
      type: `${problemTypeBase}/${exception.code.toLowerCase().replaceAll('_', '-')}`,
      title: titleForStatus(exception.status),
      status: exception.status,
      code: exception.code,
      requestId,
      ...(exception.detail === undefined ? {} : { detail: exception.detail }),
      ...(instance === undefined ? {} : { instance }),
      ...(exception.fields === undefined ? {} : { fields: exception.fields }),
    });
  }

  if (exception instanceof HttpException && exception.getStatus() < 500) {
    const status = exception.getStatus();
    return validatedProblem({
      type: `${problemTypeBase}/http-${status}`,
      title: titleForStatus(status),
      status,
      code: `HTTP_${status}`,
      requestId,
      ...(instance === undefined ? {} : { instance }),
    });
  }

  if (
    typeof exception === 'object' &&
    exception !== null &&
    'status' in exception
  ) {
    const status = exception.status;
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500
    ) {
      return validatedProblem({
        type: `${problemTypeBase}/http-${status}`,
        title: titleForStatus(status),
        status,
        code: `HTTP_${status}`,
        requestId,
        ...(instance === undefined ? {} : { instance }),
      });
    }
  }

  return validatedProblem({
    type: `${problemTypeBase}/internal-error`,
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',
    code: 'INTERNAL_ERROR',
    requestId,
    ...(instance === undefined ? {} : { instance }),
  });
}

type ErrorRequest = {
  id?: string;
  originalUrl?: string;
  url?: string;
};

@Catch()
@Injectable()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(PROBLEM_LOGGER) private readonly logger: ProblemLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ErrorRequest>();
    const response = http.getResponse<{
      setHeader?: (name: string, value: string) => void;
      status: (status: number) => { json: (body: ProblemDetails) => void };
    }>();
    const requestId = request.id ?? randomUUID();
    const requestTarget = request.originalUrl ?? request.url ?? '';
    const body = mapProblem(exception, requestId, requestTarget || undefined);

    const requestPath = requestTarget.split('?', 1)[0] ?? '';
    if (
      requestPath.startsWith('/api/v1/auth/') ||
      requestPath === '/api/v1/users/me' ||
      requestPath.startsWith('/api/v1/admin/')
    ) {
      response.setHeader?.('Cache-Control', 'no-store');
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'retryAfterSeconds' in exception &&
      typeof exception.retryAfterSeconds === 'number' &&
      Number.isInteger(exception.retryAfterSeconds) &&
      exception.retryAfterSeconds > 0
    ) {
      response.setHeader?.('Retry-After', String(exception.retryAfterSeconds));
    }

    if (body.status >= 500) {
      this.logger.error(
        {
          code: body.code,
          errorType:
            exception instanceof AppError
              ? 'AppError'
              : exception instanceof HttpException
                ? 'HttpException'
                : exception instanceof Error
                  ? 'Error'
                  : 'Unknown',
          requestId,
          status: body.status,
        },
        'Unexpected request failure',
      );
    }

    response.status(body.status).json(body);
  }
}
