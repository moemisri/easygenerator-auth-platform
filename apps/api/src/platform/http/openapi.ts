import {
  HttpException,
  applyDecorators,
  type INestApplication,
} from '@nestjs/common';
import {
  adminAuditEventsResponseSchema,
  adminUsersResponseSchema,
  assistantChatRequestSchema,
  assistantSseEventSchema,
  authSessionResponseSchema,
  problemDetailsSchema,
  safeUserSchema,
  signinSchema,
  signupSchema,
  updateAdminUserSchema,
} from '@easygenerator/contracts';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

import { AppError } from '../errors/app-error';
import { mapProblem } from '../errors/problem-details.filter';

type ComponentsObject = NonNullable<OpenAPIObject['components']>;
type SchemaOrReference = NonNullable<ComponentsObject['schemas']>[string];
type SchemaObject = Exclude<SchemaOrReference, { $ref: string }>;
type ReferenceObject = Extract<SchemaOrReference, { $ref: string }>;

const healthLivenessSchema = z.object({ status: z.literal('ok') }).strict();

const healthReadinessSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    dependencies: z
      .object({
        mongodb: z.enum(['up', 'down']),
        redis: z.enum(['up', 'down']),
      })
      .strict(),
  })
  .strict();

const sensitiveOpenApiTerms = [
  'passwordhash',
  'emailkey',
  'tokendigest',
  'sessiondigest',
  'rawtoken',
  'rawsessiontoken',
  'csrfsecret',
  'identityhashsecret',
  'actorid',
  'targetid',
  'metadata',
  'expiresat',
  'revokedat',
  'hmac',
  'gemini',
  'model',
  'configuration',
  'providerconfig',
  'identities',
  'prompt',
] as const;

type PublicSchemaName =
  | 'AdminAuditEventPage'
  | 'AdminUpdateUserRequest'
  | 'AdminUserPage'
  | 'AssistantChatRequest'
  | 'AssistantSseEvent'
  | 'AuthSessionResponse'
  | 'HealthLiveness'
  | 'HealthReadiness'
  | 'ProblemDetails'
  | 'SafeUser'
  | 'SigninRequest'
  | 'SignupRequest';

function toOpenApiSchema(
  schema: ZodType,
  io: 'input' | 'output',
): SchemaObject {
  const generated = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    reused: 'inline',
  });
  const serialized = JSON.parse(JSON.stringify(generated)) as Record<
    string,
    unknown
  >;
  delete serialized.$schema;
  delete serialized['~standard'];
  return serialized as SchemaObject;
}

function passwordRequestSchema(schema: ZodType): SchemaObject {
  const generated = toOpenApiSchema(schema, 'input');
  const password = generated.properties?.password;
  if (password === undefined || '$ref' in password) {
    throw new Error('Password request schema must expose an inline property');
  }
  password.writeOnly = true;
  return generated;
}

function adminUpdateRequestSchema(): SchemaObject {
  const generated = toOpenApiSchema(updateAdminUserSchema, 'input');
  generated.anyOf = [{ required: ['role'] }, { required: ['status'] }];
  return generated;
}

function assistantChatInputSchema(): SchemaObject {
  const generated = toOpenApiSchema(assistantChatRequestSchema, 'input');
  const history = generated.properties?.history;
  if (history === undefined || '$ref' in history) {
    throw new Error('Assistant request schema must expose inline history');
  }
  history.description =
    'Up to 6 prior turns whose combined content is at most 6,000 characters.';
  return generated;
}

function createPublicSchemaAllowlist(): Record<PublicSchemaName, SchemaObject> {
  return {
    AdminAuditEventPage: toOpenApiSchema(
      adminAuditEventsResponseSchema,
      'output',
    ),
    AdminUpdateUserRequest: adminUpdateRequestSchema(),
    AdminUserPage: toOpenApiSchema(adminUsersResponseSchema, 'output'),
    AssistantChatRequest: assistantChatInputSchema(),
    AssistantSseEvent: toOpenApiSchema(assistantSseEventSchema, 'output'),
    AuthSessionResponse: toOpenApiSchema(authSessionResponseSchema, 'output'),
    HealthLiveness: toOpenApiSchema(healthLivenessSchema, 'output'),
    HealthReadiness: toOpenApiSchema(healthReadinessSchema, 'output'),
    ProblemDetails: toOpenApiSchema(problemDetailsSchema, 'output'),
    SafeUser: toOpenApiSchema(safeUserSchema, 'output'),
    SigninRequest: passwordRequestSchema(signinSchema),
    SignupRequest: passwordRequestSchema(signupSchema),
  };
}

function schemaReference(name: PublicSchemaName): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` };
}

function apiBody(name: PublicSchemaName) {
  return ApiBody({
    required: true,
    schema: schemaReference(name),
  });
}

function apiJsonResponse(
  status: number,
  name: PublicSchemaName,
  description: string,
  examples?: Record<string, { summary: string; value: unknown }>,
) {
  return ApiResponse({
    status,
    description,
    content: {
      'application/json': {
        schema: schemaReference(name),
        ...(examples === undefined ? {} : { examples }),
      },
    },
  });
}

function problemExample(status: number, code: string) {
  const exception =
    code === `HTTP_${status}`
      ? new HttpException('', status)
      : new AppError(code, status);
  return mapProblem(
    exception,
    '01JEXAMPLE00000000000000000',
    '/api/v1/example',
  );
}

function apiProblemResponse(status: number, codes: readonly string[]) {
  const examples = Object.fromEntries(
    codes.map((code) => [
      code,
      { summary: code, value: problemExample(status, code) },
    ]),
  );
  const first = problemExample(status, codes[0] ?? `HTTP_${status}`);
  return apiJsonResponse(status, 'ProblemDetails', first.title, examples);
}

function apiSessionSecurity() {
  return applyDecorators(
    ApiSecurity('session'),
    ApiSecurity('productionSession'),
  );
}

function apiCsrfHeader() {
  return ApiHeader({
    name: 'X-CSRF-Token',
    required: true,
    description:
      'The session-bound CSRF value returned by signup, signin, or session restoration.',
    schema: { type: 'string', minLength: 1 },
  });
}

const pageQuery = () =>
  ApiQuery({
    name: 'page',
    required: false,
    description: 'One-based result page.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  });

const pageSizeQuery = () =>
  ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Results per page, capped at 50.',
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  });

export const ApiHealthLive = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'healthLive',
      summary: 'Check process liveness',
    }),
    apiJsonResponse(200, 'HealthLiveness', 'The process is running.'),
  );

export const ApiHealthReady = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'healthReady',
      summary: 'Check dependency readiness',
    }),
    apiJsonResponse(200, 'HealthReadiness', 'Readiness state.', {
      ready: {
        summary: 'All dependencies ready',
        value: {
          status: 'ok',
          dependencies: { mongodb: 'up', redis: 'up' },
        },
      },
      redisDegraded: {
        summary: 'Redis unavailable; process remains ready',
        value: {
          status: 'degraded',
          dependencies: { mongodb: 'up', redis: 'down' },
        },
      },
    }),
    apiJsonResponse(503, 'HealthReadiness', 'MongoDB unavailable.', {
      mongoUnavailable: {
        summary: 'MongoDB unavailable',
        value: {
          status: 'degraded',
          dependencies: { mongodb: 'down', redis: 'up' },
        },
      },
    }),
  );

export const ApiAuthSignup = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'authSignup',
      summary: 'Create a USER account and authenticated session',
    }),
    apiBody('SignupRequest'),
    apiJsonResponse(
      201,
      'AuthSessionResponse',
      'Account and session created. The response is not cacheable.',
    ),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(403, ['HTTP_403']),
    apiProblemResponse(409, ['EMAIL_ALREADY_REGISTERED']),
    apiProblemResponse(429, ['RATE_LIMITED']),
    apiProblemResponse(503, ['AUTH_PROTECTION_UNAVAILABLE']),
  );

export const ApiAuthSignin = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'authSignin',
      summary: 'Create an authenticated session',
    }),
    apiBody('SigninRequest'),
    apiJsonResponse(
      200,
      'AuthSessionResponse',
      'Authenticated session. The response is not cacheable.',
    ),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(401, ['INVALID_CREDENTIALS']),
    apiProblemResponse(403, ['HTTP_403']),
    apiProblemResponse(429, ['RATE_LIMITED']),
    apiProblemResponse(503, ['AUTH_PROTECTION_UNAVAILABLE']),
  );

export const ApiAuthSession = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'authSession',
      summary: 'Restore the current session',
      description: 'Returns a non-cacheable authenticated session snapshot.',
    }),
    apiSessionSecurity(),
    apiJsonResponse(200, 'AuthSessionResponse', 'Current session.'),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
  );

export const ApiAuthLogout = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'authLogout',
      summary: 'Destroy the current session',
    }),
    apiSessionSecurity(),
    apiCsrfHeader(),
    ApiResponse({ status: 204, description: 'Session destroyed.' }),
    apiProblemResponse(403, ['HTTP_403', 'CSRF_VALIDATION_FAILED']),
  );

export const ApiUsersMe = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'usersMe',
      summary: 'Get the current safe user profile',
      description: 'Returns a non-cacheable user projection.',
    }),
    apiSessionSecurity(),
    apiJsonResponse(200, 'SafeUser', 'Current user.'),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
  );

export const ApiAdminListUsers = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'adminListUsers',
      summary: 'List safe user projections',
      description:
        'Requires READ_USERS. Results and summary are non-cacheable.',
    }),
    apiSessionSecurity(),
    pageQuery(),
    pageSizeQuery(),
    ApiQuery({
      name: 'search',
      required: false,
      description: 'Trimmed name or email search without control characters.',
      schema: {
        type: 'string',
        maxLength: 100,
        pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]*$',
      },
    }),
    ApiQuery({
      name: 'sort',
      required: false,
      schema: {
        type: 'string',
        enum: ['createdAt', 'name', 'email'],
        default: 'createdAt',
      },
    }),
    ApiQuery({
      name: 'direction',
      required: false,
      schema: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'desc',
      },
    }),
    apiJsonResponse(200, 'AdminUserPage', 'Paginated safe users.'),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
    apiProblemResponse(403, ['INSUFFICIENT_CAPABILITY']),
  );

export const ApiAdminUpdateUser = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'adminUpdateUser',
      summary: 'Update a user role or status',
      description:
        'Requires MANAGE_BASIC_USERS and optimistic version matching. The response is non-cacheable.',
    }),
    apiSessionSecurity(),
    apiCsrfHeader(),
    ApiParam({
      name: 'id',
      required: true,
      description: '24-character hexadecimal user ID.',
      schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
    }),
    apiBody('AdminUpdateUserRequest'),
    apiJsonResponse(200, 'SafeUser', 'Updated safe user projection.'),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
    apiProblemResponse(403, [
      'HTTP_403',
      'CSRF_VALIDATION_FAILED',
      'INSUFFICIENT_CAPABILITY',
      'TARGET_UPDATE_FORBIDDEN',
    ]),
    apiProblemResponse(404, ['USER_NOT_FOUND']),
    apiProblemResponse(409, [
      'STALE_USER_VERSION',
      'LAST_ACTIVE_ADMIN_PROTECTED',
      'ADMIN_UPDATE_CONFLICT',
    ]),
    apiProblemResponse(429, ['RATE_LIMITED']),
    apiProblemResponse(503, ['ADMIN_MUTATION_PROTECTION_UNAVAILABLE']),
  );

export const ApiAdminAuditEvents = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'adminListAuditEvents',
      summary: 'List safe audit summaries',
      description:
        'Requires READ_AUDIT. Internal audit fields are never returned.',
    }),
    apiSessionSecurity(),
    pageQuery(),
    pageSizeQuery(),
    apiJsonResponse(
      200,
      'AdminAuditEventPage',
      'Paginated safe audit summaries.',
    ),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
    apiProblemResponse(403, ['INSUFFICIENT_CAPABILITY']),
  );

export const ApiAssistantChat = () =>
  applyDecorators(
    ApiOperation({
      operationId: 'assistantChat',
      summary: 'Stream a grounded documentation answer',
      description:
        'Use fetch with credentials and read the response body stream. This authenticated mutation requires CSRF validation and is not cacheable.',
    }),
    apiSessionSecurity(),
    apiCsrfHeader(),
    apiBody('AssistantChatRequest'),
    ApiResponse({
      status: 200,
      description:
        'A fetch response stream of sources, delta, done, and safe error events.',
      content: {
        'text/event-stream': {
          schema: {
            type: 'string',
            description:
              'UTF-8 Server-Sent Event frames whose data matches AssistantSseEvent.',
          },
          examples: {
            sources: {
              summary: 'Grounding sources',
              value:
                'event: sources\ndata: {"sources":[{"id":"security","file":"security.md","heading":"Sessions"}]}\n\n',
            },
            delta: {
              summary: 'Answer fragment',
              value: 'event: delta\ndata: {"text":"Sessions are"}\n\n',
            },
            done: {
              summary: 'Successful completion',
              value: 'event: done\ndata: {"outcome":"answered"}\n\n',
            },
            error: {
              summary: 'Safe stream failure',
              value:
                'event: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"The assistant timed out. Please try again."}\n\n',
            },
          },
        },
      },
    }),
    apiProblemResponse(400, ['VALIDATION_ERROR']),
    apiProblemResponse(401, ['UNAUTHENTICATED']),
    apiProblemResponse(403, ['HTTP_403', 'CSRF_VALIDATION_FAILED']),
    apiProblemResponse(404, ['ASSISTANT_DISABLED']),
    apiProblemResponse(429, ['RATE_LIMITED', 'ASSISTANT_STREAM_IN_PROGRESS']),
    apiProblemResponse(503, [
      'ASSISTANT_PROTECTION_UNAVAILABLE',
      'ASSISTANT_CORPUS_UNAVAILABLE',
    ]),
  );

function assertNoSensitiveSchemas(document: OpenAPIObject): void {
  const serialized = JSON.stringify(document).toLowerCase();
  for (const term of sensitiveOpenApiTerms) {
    if (serialized.includes(term)) {
      throw new Error(`Refusing to publish sensitive OpenAPI term: ${term}`);
    }
  }
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Easygenerator Authentication API')
    .setDescription(
      'Public authentication, account administration, health, and grounded assistant API.',
    )
    .setVersion('1.0.0')
    .addCookieAuth(
      'session',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
        description: 'Opaque HttpOnly cookie used outside production.',
      },
      'session',
    )
    .addCookieAuth(
      '__Host-session',
      {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-session',
        description: 'Secure opaque HttpOnly production cookie.',
      },
      'productionSession',
    )
    .build();

  const discovered = SwaggerModule.createDocument(app, config);
  const document: OpenAPIObject = {
    ...discovered,
    tags: [
      { name: 'Health', description: 'Liveness and dependency readiness.' },
      { name: 'Authentication', description: 'Session lifecycle.' },
      { name: 'Users', description: 'Current safe user profile.' },
      {
        name: 'Administration',
        description: 'Capability-protected user and audit operations.',
      },
      {
        name: 'Assistant',
        description: 'Grounded documentation streaming.',
      },
    ],
    components: {
      ...discovered.components,
      schemas: createPublicSchemaAllowlist(),
    },
  };

  assertNoSensitiveSchemas(document);
  return document;
}

export function configureOpenApi(
  app: INestApplication,
  enabled: boolean,
): void {
  if (!enabled) return;

  SwaggerModule.setup('api/docs', app, () => createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    raw: ['json'],
  });
}
