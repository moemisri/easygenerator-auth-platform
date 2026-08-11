import {
  Controller,
  Get,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminController } from '../../src/modules/admin/admin.controller';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AssistantController } from '../../src/modules/assistant/assistant.controller';
import { AssistantService } from '../../src/modules/assistant/assistant.service';
import { AuditController } from '../../src/modules/audit/audit.controller';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CookieService } from '../../src/modules/auth/cookie.service';
import { CsrfService } from '../../src/modules/auth/csrf.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { HealthController } from '../../src/modules/health/health.controller';
import { HealthService } from '../../src/modules/health/health.service';
import { UsersController } from '../../src/modules/users/users.controller';
import { configureApplication } from '../../src/main';
import { ProblemDetailsFilter } from '../../src/platform/errors/problem-details.filter';
import { OriginGuard } from '../../src/platform/http/origin.guard';
import { createOpenApiDocument } from '../../src/platform/http/openapi';

type ComponentsObject = NonNullable<OpenAPIObject['components']>;
type SchemaOrReference = NonNullable<ComponentsObject['schemas']>[string];
type SchemaObject = Exclude<SchemaOrReference, { $ref: string }>;
type ReferenceObject = Extract<SchemaOrReference, { $ref: string }>;
type PathItemObject = OpenAPIObject['paths'][string];
type OperationObject = NonNullable<PathItemObject['get']>;
type ParameterOrReference = NonNullable<OperationObject['parameters']>[number];
type ParameterObject = Exclude<ParameterOrReference, { $ref: string }>;
type ResponseOrReference = OperationObject['responses'][string];
type ResponseObject = Exclude<
  NonNullable<ResponseOrReference>,
  { $ref: string }
>;
type HttpMethod = 'get' | 'patch' | 'post';

const appOrigin = 'http://localhost:5173';

const committedControllers = [
  HealthController,
  AuthController,
  UsersController,
  AdminController,
  AuditController,
  AssistantController,
] as const;

const expectedOperations = {
  '/health/live': ['get'],
  '/health/ready': ['get'],
  '/api/v1/auth/signup': ['post'],
  '/api/v1/auth/signin': ['post'],
  '/api/v1/auth/session': ['get'],
  '/api/v1/auth/logout': ['post'],
  '/api/v1/users/me': ['get'],
  '/api/v1/admin/users': ['get'],
  '/api/v1/admin/users/{id}': ['patch'],
  '/api/v1/admin/audit-events': ['get'],
  '/api/v1/assistant/chat': ['post'],
} as const;

const expectedResponseMaps = {
  '/health/live': { get: { '200': ['application/json'] } },
  '/health/ready': {
    get: {
      '200': ['application/json'],
      '503': ['application/json'],
    },
  },
  '/api/v1/auth/signup': {
    post: {
      '201': ['application/json'],
      '400': ['application/json'],
      '403': ['application/json'],
      '409': ['application/json'],
      '429': ['application/json'],
      '503': ['application/json'],
    },
  },
  '/api/v1/auth/signin': {
    post: {
      '200': ['application/json'],
      '400': ['application/json'],
      '401': ['application/json'],
      '403': ['application/json'],
      '429': ['application/json'],
      '503': ['application/json'],
    },
  },
  '/api/v1/auth/session': {
    get: { '200': ['application/json'], '401': ['application/json'] },
  },
  '/api/v1/auth/logout': {
    post: { '204': [], '403': ['application/json'] },
  },
  '/api/v1/users/me': {
    get: { '200': ['application/json'], '401': ['application/json'] },
  },
  '/api/v1/admin/users': {
    get: {
      '200': ['application/json'],
      '400': ['application/json'],
      '401': ['application/json'],
      '403': ['application/json'],
    },
  },
  '/api/v1/admin/users/{id}': {
    patch: {
      '200': ['application/json'],
      '400': ['application/json'],
      '401': ['application/json'],
      '403': ['application/json'],
      '404': ['application/json'],
      '409': ['application/json'],
    },
  },
  '/api/v1/admin/audit-events': {
    get: {
      '200': ['application/json'],
      '400': ['application/json'],
      '401': ['application/json'],
      '403': ['application/json'],
    },
  },
  '/api/v1/assistant/chat': {
    post: {
      '200': ['text/event-stream'],
      '400': ['application/json'],
      '401': ['application/json'],
      '403': ['application/json'],
      '404': ['application/json'],
      '429': ['application/json'],
      '503': ['application/json'],
    },
  },
} as const;

const forbiddenPublicTerms = [
  'passwordHash',
  'emailKey',
  'tokenDigest',
  'sessionDigest',
  'rawToken',
  'rawSessionToken',
  'csrfSecret',
  'identityHashSecret',
  'actorId',
  'targetId',
  'metadata',
  'expiresAt',
  'revokedAt',
  'hmac',
  'geminiApiKey',
  'geminiModel',
  'model',
  'configuration',
  'providerConfig',
  'identities',
  'systemPrompt',
] as const;

function operation(
  document: OpenAPIObject,
  path: keyof typeof expectedOperations,
  method: HttpMethod,
): OperationObject {
  const value = document.paths[path]?.[method];
  if (value === undefined) throw new Error(`Missing ${method} ${path}`);
  return value;
}

function parameters(operation_: OperationObject): ParameterObject[] {
  return (operation_.parameters ?? []).filter(
    (parameter): parameter is ParameterObject => !('$ref' in parameter),
  );
}

function responseObject(
  operation_: OperationObject,
  status: string,
): ResponseObject {
  const response = operation_.responses[status];
  if (response === undefined || '$ref' in response) {
    throw new Error(`Missing inline ${status} response`);
  }
  return response;
}

function schemaFromResponse(
  operation_: OperationObject,
  status: string,
  mediaType: string,
): SchemaObject | ReferenceObject {
  const schema = responseObject(operation_, status).content?.[mediaType]
    ?.schema;
  if (schema === undefined) {
    throw new Error(`Missing ${status} ${mediaType} response schema`);
  }
  return schema;
}

@Controller('review-leak')
class LeakyController {
  @Get()
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: { emailKey: { type: 'string' } },
    },
  })
  leak() {
    return {};
  }
}

describe('public OpenAPI document', () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createControllerApp(
    controllers: readonly Type<unknown>[],
    initialize = false,
  ): Promise<NestExpressApplication> {
    const module = await Test.createTestingModule({
      controllers: [...controllers],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'ASSISTANT_ENABLED') return false;
              if (key === 'APP_ORIGIN') return appOrigin;
              throw new Error(`Unexpected config key ${key}`);
            },
          },
        },
        { provide: AuthService, useValue: {} },
        { provide: CookieService, useValue: {} },
        { provide: CsrfService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: AdminService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: AssistantService, useValue: {} },
        {
          provide: HealthService,
          useValue: {
            live: () => ({ status: 'ok' }),
            ready: async () => ({
              status: 'ok',
              dependencies: { mongodb: 'up', redis: 'up' },
            }),
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(
      app,
      { TRUST_PROXY_HOPS: 0, SWAGGER_ENABLED: false },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    app.useGlobalGuards(new OriginGuard(appOrigin));
    if (initialize) await app.init();
    apps.push(app);
    return app;
  }

  async function fullDocument(): Promise<OpenAPIObject> {
    return createOpenApiDocument(
      await createControllerApp(committedControllers),
    );
  }

  it('derives the route inventory from the actual controllers in the Nest application', async () => {
    const healthDocument = createOpenApiDocument(
      await createControllerApp([HealthController]),
    );
    expect(Object.keys(healthDocument.paths).sort()).toEqual([
      '/health/live',
      '/health/ready',
    ]);

    const document = await fullDocument();
    expect(Object.keys(document.paths).sort()).toEqual(
      Object.keys(expectedOperations).sort(),
    );
    for (const [path, methods] of Object.entries(expectedOperations)) {
      expect(Object.keys(document.paths[path] ?? {}).sort()).toEqual(methods);
    }
  });

  it('documents the complete status and content map for every operation', async () => {
    const document = await fullDocument();

    for (const [path, methods] of Object.entries(expectedResponseMaps)) {
      for (const [method, expectedResponses] of Object.entries(methods)) {
        const responses = operation(
          document,
          path as keyof typeof expectedOperations,
          method as HttpMethod,
        ).responses;
        const actual = Object.fromEntries(
          Object.entries(responses).map(([status, response]) => {
            if (response === undefined) {
              throw new Error(`Missing ${status} response`);
            }
            return [
              status,
              '$ref' in response
                ? ['$ref']
                : Object.keys(response.content ?? {}).sort(),
            ];
          }),
        );
        expect(actual).toEqual(expectedResponses);
      }
    }
  });

  it('matches documented error media types to real filtered HTTP responses', async () => {
    const app = await createControllerApp([AuthController], true);
    const document = createOpenApiDocument(app);
    const signup = operation(document, '/api/v1/auth/signup', 'post');

    const validation = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send({ email: 'invalid', name: 'Ada Tester', password: 'Secure1!' })
      .expect(400);
    expect(validation.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(responseObject(signup, '400').content ?? {})).toEqual([
      'application/json',
    ]);

    const origin = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'ada@example.com',
        name: 'Ada Tester',
        password: 'Secure1!',
      })
      .expect(403);
    expect(origin.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(responseObject(signup, '403').content ?? {})).toEqual([
      'application/json',
    ]);
  });

  it('uses runtime-derived problem examples and the production problem type host', async () => {
    const document = await fullDocument();
    const titles: Record<string, string> = {
      '400': 'BAD REQUEST',
      '401': 'UNAUTHORIZED',
      '403': 'FORBIDDEN',
      '404': 'NOT FOUND',
      '409': 'CONFLICT',
      '429': 'TOO MANY REQUESTS',
      '503': 'SERVICE UNAVAILABLE',
    };

    for (const [path, methods] of Object.entries(expectedResponseMaps)) {
      for (const method of Object.keys(methods)) {
        const responses = operation(
          document,
          path as keyof typeof expectedOperations,
          method as HttpMethod,
        ).responses;
        for (const [status, response] of Object.entries(responses)) {
          if (!(status in titles) || path === '/health/ready') continue;
          if (response === undefined) throw new Error('Missing response');
          if ('$ref' in response) throw new Error('Unexpected response ref');
          const examples = response.content?.['application/json']?.examples;
          expect(examples).toBeDefined();
          for (const example of Object.values(examples ?? {})) {
            if ('$ref' in example) throw new Error('Unexpected example ref');
            expect(example.value).toMatchObject({
              status: Number(status),
              title: titles[status],
              type: expect.stringMatching(
                /^https:\/\/easygenerator\.com\/problems\//,
              ),
            });
          }
        }
      }
    }
  });

  it('documents both exact session cookie names and session-bound CSRF mutations', async () => {
    const document = await fullDocument();
    expect(document.components?.securitySchemes).toMatchObject({
      session: { type: 'apiKey', in: 'cookie', name: 'session' },
      productionSession: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-session',
      },
    });

    for (const [path, method] of [
      ['/api/v1/auth/session', 'get'],
      ['/api/v1/auth/logout', 'post'],
      ['/api/v1/users/me', 'get'],
      ['/api/v1/admin/users', 'get'],
      ['/api/v1/admin/users/{id}', 'patch'],
      ['/api/v1/admin/audit-events', 'get'],
      ['/api/v1/assistant/chat', 'post'],
    ] as const) {
      expect(operation(document, path, method).security).toEqual([
        { session: [] },
        { productionSession: [] },
      ]);
    }

    for (const [path, method] of [
      ['/api/v1/auth/logout', 'post'],
      ['/api/v1/admin/users/{id}', 'patch'],
      ['/api/v1/assistant/chat', 'post'],
    ] as const) {
      const csrf = parameters(operation(document, path, method)).find(
        (parameter) => parameter.name === 'X-CSRF-Token',
      );
      expect(csrf).toMatchObject({
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1 },
      });
      expect(csrf?.description).toContain('session-bound');
    }

    for (const [path, method] of [
      ['/health/live', 'get'],
      ['/health/ready', 'get'],
      ['/api/v1/auth/signup', 'post'],
      ['/api/v1/auth/signin', 'post'],
    ] as const) {
      expect(operation(document, path, method).security ?? []).toEqual([]);
    }
  });

  it('documents strict admin pagination, sorting, search, and user IDs', async () => {
    const document = await fullDocument();
    const listParameters = parameters(
      operation(document, '/api/v1/admin/users', 'get'),
    );
    const byName = Object.fromEntries(
      listParameters.map((parameter) => [parameter.name, parameter]),
    );

    expect(byName.page).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, default: 1 },
    });
    expect(byName.pageSize).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    });
    expect(byName.search).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'string', maxLength: 100 },
    });
    expect(byName.sort).toMatchObject({
      schema: {
        type: 'string',
        enum: ['createdAt', 'name', 'email'],
        default: 'createdAt',
      },
    });
    expect(byName.direction).toMatchObject({
      schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    });

    const id = parameters(
      operation(document, '/api/v1/admin/users/{id}', 'patch'),
    ).find((parameter) => parameter.name === 'id');
    expect(id).toMatchObject({
      in: 'path',
      required: true,
      schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
    });
  });

  it('keeps an authoritative public schema allowlist and denies internal vocabulary case-insensitively', async () => {
    const document = await fullDocument();
    expect(Object.keys(document.components?.schemas ?? {}).sort()).toEqual(
      [
        'AdminAuditEventPage',
        'AdminUpdateUserRequest',
        'AdminUserPage',
        'AssistantChatRequest',
        'AssistantSseEvent',
        'AuthSessionResponse',
        'HealthLiveness',
        'HealthReadiness',
        'ProblemDetails',
        'SafeUser',
        'SigninRequest',
        'SignupRequest',
      ].sort(),
    );

    for (const schemaName of ['SignupRequest', 'SigninRequest'] as const) {
      const schema = document.components?.schemas?.[schemaName] as SchemaObject;
      expect(schema.properties?.password).toMatchObject({ writeOnly: true });
    }

    const serialized = JSON.stringify(document).toLowerCase();
    for (const term of forbiddenPublicTerms) {
      expect(serialized).not.toContain(term.toLowerCase());
    }

    const leakyApp = await createControllerApp([LeakyController]);
    expect(() => createOpenApiDocument(leakyApp)).toThrow(/emailkey/i);
  });

  it('preserves strict request constraints that JSON Schema cannot infer from Zod refinements', async () => {
    const document = await fullDocument();
    const update = document.components?.schemas
      ?.AdminUpdateUserRequest as SchemaObject;
    expect(update).toMatchObject({
      required: ['version'],
      additionalProperties: false,
      anyOf: [{ required: ['role'] }, { required: ['status'] }],
    });

    const assistant = document.components?.schemas
      ?.AssistantChatRequest as SchemaObject;
    const history = assistant.properties?.history;
    expect(history).not.toHaveProperty('$ref');
    expect(history).toMatchObject({
      type: 'array',
      maxItems: 6,
      description: expect.stringContaining('6,000'),
    });
  });

  it('documents readiness semantics and fetch-based SSE examples', async () => {
    const document = await fullDocument();
    const readiness = operation(document, '/health/ready', 'get');
    const readyExamples = responseObject(readiness, '200').content?.[
      'application/json'
    ]?.examples;
    const unavailableExamples = responseObject(readiness, '503').content?.[
      'application/json'
    ]?.examples;
    expect(readyExamples).toMatchObject({
      ready: {
        value: {
          status: 'ok',
          dependencies: { mongodb: 'up', redis: 'up' },
        },
      },
      redisDegraded: {
        value: {
          status: 'degraded',
          dependencies: { mongodb: 'up', redis: 'down' },
        },
      },
    });
    expect(unavailableExamples).toMatchObject({
      mongoUnavailable: {
        value: {
          status: 'degraded',
          dependencies: { mongodb: 'down', redis: 'up' },
        },
      },
    });

    const chat = operation(document, '/api/v1/assistant/chat', 'post');
    const stream = responseObject(chat, '200').content?.['text/event-stream'];
    const serializedExamples = JSON.stringify(stream?.examples);
    expect(responseObject(chat, '200').description).toContain('fetch');
    expect(responseObject(chat, '200').description).not.toContain(
      'EventSource',
    );
    expect(stream?.schema).toMatchObject({ type: 'string' });
    for (const event of ['sources', 'delta', 'done', 'error']) {
      expect(serializedExamples).toContain(`event: ${event}`);
    }
    expect(serializedExamples).not.toContain('stack');
    expect(serializedExamples).not.toContain('key');
  });

  it('keeps all successful response schemas password-free', async () => {
    const document = await fullDocument();
    for (const [path, methods] of Object.entries(expectedOperations)) {
      for (const method of methods) {
        const responses = operation(
          document,
          path as keyof typeof expectedOperations,
          method,
        ).responses;
        for (const [status, response] of Object.entries(responses)) {
          if (!status.startsWith('2')) continue;
          expect(JSON.stringify(response)).not.toContain('password');
        }
      }
    }

    expect(
      schemaFromResponse(
        operation(document, '/api/v1/auth/signup', 'post'),
        '201',
        'application/json',
      ),
    ).toEqual({ $ref: '#/components/schemas/AuthSessionResponse' });
  });
});
