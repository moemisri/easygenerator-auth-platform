import {
  problemDetailsSchema,
  type FieldError,
} from '@easygenerator/contracts';

import { publishAuthExpiry } from '../features/auth/auth-expiry';

export class ApiProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly retryAfter?: number,
    public readonly detail?: string,
    public readonly instance?: string,
    public readonly fields?: FieldError[],
  ) {
    super(title);
  }
}

type Schema<T> = { parse: (value: unknown) => T };

type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  authenticationFailure?: 'expire-session' | 'form-or-restoration';
  body?: unknown;
  csrfToken?: string;
  headers?: HeadersInit;
};

function retryAfterSeconds(value: string | null): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export const apiClient = {
  async request<T>(
    path: string,
    schema: Schema<T> | undefined,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      authenticationFailure = 'expire-session',
      body,
      csrfToken,
      headers: suppliedHeaders,
      ...init
    } = options;
    const headers = new Headers(suppliedHeaders);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const method = init.method ?? 'GET';
    if (
      csrfToken &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
    ) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    const request: RequestInit = {
      ...init,
      method,
      headers,
      credentials: 'include',
    };
    if (body !== undefined) request.body = JSON.stringify(body);
    const response = await fetch(path, request);
    const payload = await responseBody(response);
    if (!response.ok) {
      const parsedProblem = problemDetailsSchema.safeParse(payload);
      const problem = parsedProblem.success ? parsedProblem.data : undefined;
      const apiProblem = new ApiProblem(
        response.status,
        typeof problem?.title === 'string' ? problem.title : 'Request failed',
        typeof problem?.code === 'string' ? problem.code : undefined,
        typeof problem?.requestId === 'string' ? problem.requestId : undefined,
        retryAfterSeconds(response.headers.get('Retry-After')),
        problem?.detail,
        problem?.instance,
        problem?.fields,
      );
      if (
        response.status === 401 &&
        authenticationFailure === 'expire-session'
      ) {
        publishAuthExpiry();
      }
      throw apiProblem;
    }
    if (!schema) return undefined as T;
    try {
      return schema.parse(payload);
    } catch {
      throw new ApiProblem(response.status, 'Invalid server response');
    }
  },
};
