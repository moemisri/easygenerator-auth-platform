import type { ProblemDetails } from '@easygenerator/contracts';
import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AppError } from './app-error';

const problemTypeBase = 'https://easygenerator.com/problems';

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
    return {
      type: `${problemTypeBase}/${exception.code.toLowerCase().replaceAll('_', '-')}`,
      title: titleForStatus(exception.status),
      status: exception.status,
      code: exception.code,
      requestId,
      ...(exception.detail === undefined ? {} : { detail: exception.detail }),
      ...(instance === undefined ? {} : { instance }),
      ...(exception.fields === undefined ? {} : { fields: exception.fields }),
    };
  }

  if (exception instanceof HttpException && exception.getStatus() < 500) {
    const status = exception.getStatus();
    return {
      type: `${problemTypeBase}/http-${status}`,
      title: titleForStatus(status),
      status,
      code: `HTTP_${status}`,
      requestId,
      ...(instance === undefined ? {} : { instance }),
    };
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
      return {
        type: `${problemTypeBase}/http-${status}`,
        title: titleForStatus(status),
        status,
        code: `HTTP_${status}`,
        requestId,
        ...(instance === undefined ? {} : { instance }),
      };
    }
  }

  return {
    type: `${problemTypeBase}/internal-error`,
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',
    code: 'INTERNAL_ERROR',
    requestId,
    ...(instance === undefined ? {} : { instance }),
  };
}

type ErrorRequest = {
  id?: string;
  originalUrl?: string;
  url?: string;
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ErrorRequest>();
    const response = http.getResponse<{
      status: (status: number) => { json: (body: ProblemDetails) => void };
    }>();
    const requestId = request.id ?? randomUUID();
    const body = mapProblem(
      exception,
      requestId,
      request.originalUrl ?? request.url,
    );

    response.status(body.status).json(body);
  }
}
