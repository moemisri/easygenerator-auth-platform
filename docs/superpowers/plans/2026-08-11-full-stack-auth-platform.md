# Full-Stack Authentication Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure React/NestJS authentication application with opaque sessions, four-role administration, Redis protections, a documentation-grounded Gemini SSE assistant, automated tests, Docker, CI-gated Render deployment, and complete assessment documentation.

**Architecture:** A pnpm TypeScript monorepo contains a React/Vite SPA, a NestJS modular monolith, and shared Zod contracts. NestJS serves the SPA in production, stores authoritative users/sessions/audits in a new MongoDB database, uses Redis-compatible Render Key Value for limits and safe retrieval caching, and isolates Gemini behind a feature-flagged provider interface.

**Tech Stack:** Node.js 24.18.0 LTS, pnpm 11.0.6, TypeScript strict mode, React, Vite, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS, Radix primitives, NestJS, Mongoose, Argon2id, ioredis, Pino, `@google/genai`, Vitest, React Testing Library, Supertest, Playwright, Docker Compose, GitHub Actions, Render, MongoDB Atlas, Render Key Value.

## Global Constraints

- Use Node.js `24.18.0` and pnpm `11.0.6`; commit the pnpm lockfile and use frozen installs in CI and Docker.
- All application code is TypeScript with `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` enabled.
- Production is same-origin: NestJS serves React and all APIs use `/api/v1`; do not enable cross-origin API access in production.
- Public signup always creates an `ACTIVE` `USER`; client input never controls role or status.
- Password validation is exactly: 8–128 characters, at least one ASCII letter, one number, and one non-alphanumeric character; name is trimmed to 3–80 characters; email is trimmed, format-validated, and capped at 254 characters.
- Use a seven-day opaque server-side session; production cookie name is `__Host-session` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, and no `Domain`.
- Store only SHA-256 session-token digests. Use Argon2id for passwords with `memoryCost=19456 KiB`, `timeCost=2`, and `parallelism=1`.
- Require exact-origin, Fetch Metadata, and session-bound `X-CSRF-Token` checks on cookie-authenticated mutations.
- MongoDB is authorization truth; Redis is never used for roles, account status, sessions, or permission decisions.
- Use the approved existing Atlas connection only with a new database name, defaulting to `easygenerator_auth`; never inspect or mutate existing application databases.
- Gemini may receive only committed Markdown from `docs/assistant-public/`; never send source code, environment data, user data, secrets, or raw audit records.
- The assistant is feature-flagged, excluded from readiness, mocked in automated tests, and implemented only after required auth/admin behavior is passing.
- The protected page must display the exact copy `Welcome to the application.`
- Never commit credentials, `.env` files, tokens, connection strings, generated answers, or recruiter demo passwords.
- Every task follows red-green-refactor, ends with focused verification, and creates one reviewable commit.

---

## Planned file structure

```text
.
├── .github/
│   ├── dependabot.yml
│   └── workflows/ci.yml
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.module.ts
│   │   │   ├── main.ts
│   │   │   ├── platform/
│   │   │   │   ├── config/
│   │   │   │   ├── database/
│   │   │   │   ├── errors/
│   │   │   │   ├── http/
│   │   │   │   ├── logging/
│   │   │   │   └── redis/
│   │   │   └── modules/
│   │   │       ├── admin/
│   │   │       ├── assistant/
│   │   │       ├── audit/
│   │   │       ├── auth/
│   │   │       ├── health/
│   │   │       └── users/
│   │   └── test/
│   │       ├── fixtures/
│   │       ├── integration/
│   │       └── support/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── admin/
│       │   │   ├── assistant/
│       │   │   └── auth/
│       │   ├── lib/
│       │   ├── pages/
│       │   └── styles/
│       └── tests/
├── packages/contracts/src/
│   ├── admin.ts
│   ├── assistant.ts
│   ├── auth.ts
│   ├── common.ts
│   ├── index.ts
│   └── user.ts
├── docs/
│   ├── assistant-public/
│   └── superpowers/
├── e2e/
├── AI.md
├── README.md
├── Dockerfile
├── compose.yaml
├── compose.test.yaml
├── render.yaml
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── scripts/
│   ├── post-deploy-smoke.mjs
│   ├── run-e2e.mjs
│   └── run-integration-tests.mjs
└── tsconfig.base.json
```

`packages/contracts` owns wire validation and safe response types. API modules own domain logic and persistence. Web feature folders own page-specific UI and queries. Platform code contains only cross-cutting adapters and never domain rules.

---

### Task 1: Bootstrap a tested monorepo vertical slice

**Files:**
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `.prettierignore`
- Create: `.prettierrc.json`
- Create: `eslint.config.mjs`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`
- Create: `apps/api/src/modules/health/health.controller.spec.ts`
- Create: `apps/api/src/modules/health/health.module.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/App.test.tsx`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/styles/index.css`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: none; this is the repository foundation.
- Produces: workspace packages `@easygenerator/api`, `@easygenerator/web`, and `@easygenerator/contracts`; `GET /health/live -> { status: "ok" }`; root scripts `build`, `dev`, `format:check`, `lint`, `test`, and `typecheck`.

- [ ] **Step 1: Create deterministic workspace configuration**

Use this root manifest shape:

```json
{
  "name": "easygenerator-auth-platform",
  "private": true,
  "version": "1.0.0",
  "packageManager": "pnpm@11.0.6",
  "engines": { "node": "24.18.x" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "dev": "pnpm --parallel --filter @easygenerator/api --filter @easygenerator/web dev",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "pnpm -r --if-present lint",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  }
}
```

Use these exact package scripts:

```json
// apps/api/package.json
{
  "scripts": {
    "build": "nest build",
    "dev": "tsx watch src/main.ts",
    "lint": "eslint src test",
    "test": "vitest run --exclude test/integration/**",
    "typecheck": "tsc --noEmit"
  }
}

// apps/web/package.json
{
  "scripts": {
    "build": "tsc --noEmit && vite build",
    "dev": "vite",
    "lint": "eslint src tests",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}

// packages/contracts/package.json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Set `.nvmrc` to `24.18.0`. Extend `tsconfig.base.json` with strict flags from Global Constraints plus Nest's decorator metadata options. Configure Vite to proxy `/api` and `/health` to `http://localhost:3000`. Declare `@easygenerator/contracts: workspace:*` in both application manifests. The contracts package builds to `dist`, publishes only `dist` through its local `exports`, and is built first through pnpm's dependency topology.

- [ ] **Step 2: Install the minimum foundation dependencies**

Run:

```bash
pnpm install
pnpm --filter @easygenerator/api add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
pnpm --filter @easygenerator/api add -D @nestjs/cli @nestjs/testing @types/node tsx typescript vite-tsconfig-paths vitest
pnpm --filter @easygenerator/web add @tanstack/react-query react react-dom react-router-dom
pnpm --filter @easygenerator/web add -D @testing-library/jest-dom @testing-library/react @testing-library/user-event @types/react @types/react-dom @vitejs/plugin-react jsdom typescript vite vitest
pnpm --filter @easygenerator/contracts add zod
pnpm --filter @easygenerator/contracts add -D typescript vitest
pnpm add -Dw @eslint/js eslint eslint-config-prettier globals prettier typescript-eslint
```

- [ ] **Step 3: Write failing API and web smoke tests**

```ts
// apps/api/src/modules/health/health.controller.spec.ts
it('reports process liveness', () => {
  expect(new HealthController().live()).toEqual({ status: 'ok' });
});

// apps/web/src/app/App.test.tsx
it('renders the product entry point', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /secure access/i })).toBeVisible();
});
```

- [ ] **Step 4: Run the focused tests and verify red**

Run:

```bash
pnpm --filter @easygenerator/api test -- health.controller.spec.ts
pnpm --filter @easygenerator/web test -- App.test.tsx
```

Expected: FAIL because `HealthController.live()` and the product entry UI do not exist.

- [ ] **Step 5: Implement the smallest running API and SPA**

```ts
// apps/api/src/modules/health/health.controller.ts
@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'ok' as const };
  }
}

// apps/web/src/app/App.tsx
export function App() {
  return <h1>Secure access</h1>;
}
```

Bootstrap Nest on `process.env.PORT ?? 3000`, import `reflect-metadata`, and wire the health module. Bootstrap React in strict mode with a QueryClient and BrowserRouter.

- [ ] **Step 6: Verify the complete foundation**

Run:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits `0`; both smoke tests pass and both packages build.

- [ ] **Step 7: Commit the vertical slice**

```bash
git add .editorconfig .gitignore .nvmrc .prettierignore .prettierrc.json eslint.config.mjs package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json apps packages
git commit -m "chore: bootstrap full-stack workspace"
```

---

### Task 2: Define shared auth and error contracts

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/auth.test.ts`
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/user.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Zod from Task 1.
- Produces: `Role`, `UserStatus`, `SafeUser`, `signupSchema`, `signinSchema`, `authSessionResponseSchema`, `problemDetailsSchema`, and inferred request/response types.

- [ ] **Step 1: Write contract tests for every assignment rule**

```ts
describe('signupSchema', () => {
  const valid = { email: 'Ada@Example.com', name: 'Ada', password: 'Secure1!' };

  it('trims identity fields without changing the password', () => {
    expect(signupSchema.parse({ ...valid, email: ' Ada@Example.com ', name: ' Ada ' }))
      .toEqual(valid);
  });

  it.each([
    ['short', 'Aa1!'],
    ['letter', '1234567!'],
    ['number', 'Password!'],
    ['special', 'Password1'],
  ])('rejects a password missing %s', (_rule, password) => {
    expect(signupSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it('rejects client-controlled authorization fields', () => {
    expect(signupSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract test and verify red**

Run: `pnpm --filter @easygenerator/contracts test -- auth.test.ts`

Expected: FAIL because the schemas and enums are not exported.

- [ ] **Step 3: Implement strict runtime schemas**

```ts
export const roleSchema = z.enum(['USER', 'SUPPORT', 'MANAGER', 'ADMIN']);
export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

const passwordSchema = z.string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Add at least one letter.')
  .regex(/[0-9]/, 'Add at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Add at least one special character.');

export const signupSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254),
  name: z.string().trim().min(3, 'Use at least 3 characters.').max(80),
  password: passwordSchema,
}).strict();

export const signinSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254),
  password: z.string().min(1).max(128),
}).strict();
```

Define `safeUserSchema` with `id`, `email`, `name`, `role`, `status`, `version`, `createdAt`, and `updatedAt`. Define `authSessionResponseSchema` as `{ user: safeUserSchema, csrfToken: z.string().min(32), features: { assistant: z.boolean() } }`. Define RFC-style problem details with stable `code`, `requestId`, and optional field-error arrays.

- [ ] **Step 4: Verify contracts and public exports**

Run:

```bash
pnpm --filter @easygenerator/contracts test
pnpm --filter @easygenerator/contracts typecheck
```

Expected: PASS with no inferred `any` types and no role/status fields accepted by signup.

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/contracts
git commit -m "feat: define shared authentication contracts"
```

---

### Task 3: Build the API platform boundary

**Files:**
- Create: `apps/api/src/platform/config/config.schema.ts`
- Create: `apps/api/src/platform/config/config.schema.spec.ts`
- Create: `apps/api/src/platform/config/configuration.ts`
- Create: `apps/api/src/platform/database/database.module.ts`
- Create: `apps/api/src/platform/errors/app-error.ts`
- Create: `apps/api/src/platform/errors/problem-details.filter.ts`
- Create: `apps/api/src/platform/errors/problem-details.filter.spec.ts`
- Create: `apps/api/src/platform/http/origin.guard.ts`
- Create: `apps/api/src/platform/http/request-id.middleware.ts`
- Create: `apps/api/src/platform/http/zod-validation.pipe.ts`
- Create: `apps/api/src/platform/logging/logging.module.ts`
- Create: `apps/api/src/platform/redis/redis.constants.ts`
- Create: `apps/api/src/platform/redis/redis.module.ts`
- Create: `apps/api/src/modules/health/health.service.ts`
- Modify: `apps/api/src/modules/health/health.controller.ts`
- Modify: `apps/api/src/modules/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `problemDetailsSchema` from Task 2.
- Produces: validated `AppConfig`; `AppError(code, status, detail?, fields?)`; request IDs; `REDIS` ioredis injection token; `GET /health/live`; `GET /health/ready -> { status: "ok" | "degraded", dependencies }`.

- [ ] **Step 1: Install platform dependencies**

Run:

```bash
pnpm --filter @easygenerator/api add @nestjs/config @nestjs/mongoose @nestjs/swagger cookie-parser helmet ioredis mongoose nestjs-pino pino pino-http zod
pnpm --filter @easygenerator/api add -D @types/cookie-parser pino-pretty supertest @types/supertest
```

- [ ] **Step 2: Write failing configuration and error-envelope tests**

```ts
it('refuses production without secure secrets', () => {
  expect(() => configSchema.parse({ NODE_ENV: 'production', PORT: '3000' }))
    .toThrow();
});

it('maps an AppError without leaking its stack', async () => {
  const body = mapProblem(new AppError('INVALID_CREDENTIALS', 401), 'req-123');
  expect(body).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', requestId: 'req-123' });
  expect(body).not.toHaveProperty('stack');
});
```

- [ ] **Step 3: Run the platform tests and verify red**

Run: `pnpm --filter @easygenerator/api test -- config.schema.spec.ts problem-details.filter.spec.ts`

Expected: FAIL because configuration parsing and problem mapping do not exist.

- [ ] **Step 4: Implement fail-fast configuration**

Require these production values: `MONGODB_URI`, `DB_NAME=easygenerator_auth`, `REDIS_URL`, `CSRF_SECRET`, `IDENTITY_HASH_SECRET`, `TRUST_PROXY_HOPS`, and `LOG_LEVEL`. Validate the two HMAC secrets as at least 32 bytes of base64-decoded entropy and reject `COOKIE_SECURE=false` in production. Resolve the allowed origin from an explicit HTTPS `APP_ORIGIN`, or from `https://${RENDER_EXTERNAL_HOSTNAME}` only when the hostname matches Render's validated hostname pattern; fail startup when neither is available. When `ASSISTANT_ENABLED=true`, also require non-empty `GEMINI_API_KEY`, `GEMINI_MODEL`, and the fixed corpus path `docs/assistant-public`.

Use safe defaults only in test/development:

```ts
const defaults = {
  PORT: 3000,
  DB_NAME: 'easygenerator_auth',
  SESSION_TTL_SECONDS: 604800,
  COOKIE_SECURE: false,
  ASSISTANT_ENABLED: false,
} as const;
```

- [ ] **Step 5: Implement global HTTP and logging setup**

In `main.ts`, configure `trust proxy` from validated hops, request IDs, Pino redaction, `cookieParser`, a 32 KiB JSON limit, Helmet/CSP, the global Zod pipe, the problem-details filter, `setGlobalPrefix('api/v1')` with both health routes excluded, and graceful shutdown. Do not call `enableCors()` for the same-origin app. Production SPA serving is added with the production image in Task 12.

Redact at least:

```ts
const redact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.csrfToken',
  'res.headers.set-cookie',
  '*.MONGODB_URI',
  '*.REDIS_URL',
  '*.GEMINI_API_KEY',
];
```

- [ ] **Step 6: Implement dependency-aware health checks**

`live()` always reports the process. `ready()` pings MongoDB and Redis with 1-second deadlines. Return `503` when MongoDB fails; return `200` and `status: "degraded"` when only Redis fails. Do not call Gemini.

- [ ] **Step 7: Run focused and package verification**

Run:

```bash
pnpm --filter @easygenerator/api test
pnpm --filter @easygenerator/api typecheck
pnpm --filter @easygenerator/api build
```

Expected: PASS; production-config tests reject missing/insecure values and errors match the shared schema.

- [ ] **Step 8: Commit the API platform**

```bash
git add apps/api packages/contracts
git commit -m "feat: add secure API platform foundation"
```

---

### Task 4: Implement user, session, password, CSRF, and audit primitives

**Files:**
- Create: `apps/api/src/modules/users/schemas/user.schema.ts`
- Create: `apps/api/src/modules/users/users.repository.ts`
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Create: `apps/api/src/modules/auth/schemas/session.schema.ts`
- Create: `apps/api/src/modules/auth/password.service.ts`
- Create: `apps/api/src/modules/auth/password.service.spec.ts`
- Create: `apps/api/src/modules/auth/session.repository.ts`
- Create: `apps/api/src/modules/auth/session.service.ts`
- Create: `apps/api/src/modules/auth/session.service.spec.ts`
- Create: `apps/api/src/modules/auth/csrf.service.ts`
- Create: `apps/api/src/modules/auth/csrf.service.spec.ts`
- Create: `apps/api/src/modules/audit/schemas/audit-event.schema.ts`
- Create: `apps/api/src/modules/audit/audit.service.ts`
- Create: `apps/api/src/modules/audit/audit.module.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: Mongoose connection and validated secrets from Task 3; `Role`, `UserStatus`, and `SafeUser` from Task 2.
- Produces: `PasswordService.hash/verify`; `UsersService.createUser/findForAuthentication/findSafeById`; `SessionService.create/resolve/revoke/revokeAllForUser`; `CsrfService.issue/verify`; `AuditService.record`.

```ts
export interface CreatedSession {
  rawToken: string;
  expiresAt: Date;
}

export interface AuthenticatedPrincipal {
  sessionId: string;
  user: SafeUser;
}

export interface SessionService {
  create(userId: string, dbSession?: ClientSession): Promise<CreatedSession>;
  resolve(rawToken: string): Promise<AuthenticatedPrincipal | null>;
  revoke(rawToken: string, dbSession?: ClientSession): Promise<void>;
  revokeAllForUser(userId: string, dbSession?: ClientSession): Promise<void>;
}
```

- [ ] **Step 1: Install cryptographic dependency**

Run: `pnpm --filter @easygenerator/api add argon2`

- [ ] **Step 2: Write failing password and CSRF tests**

```ts
it('hashes with Argon2id and verifies without exposing the password', async () => {
  const hash = await service.hash('Secure1!');
  expect(hash).toMatch(/^\$argon2id\$/);
  await expect(service.verify(hash, 'Secure1!')).resolves.toBe(true);
  expect(hash).not.toContain('Secure1!');
});

it('binds a CSRF token to one raw session token', () => {
  const csrf = service.issue('session-a');
  expect(service.verify('session-a', csrf)).toBe(true);
  expect(service.verify('session-b', csrf)).toBe(false);
});
```

- [ ] **Step 3: Write a failing session-storage test**

Use fixed random bytes and an in-memory repository double:

```ts
it('persists only a digest and enforces absolute expiry', async () => {
  const created = await service.create(userId);
  expect(created.rawToken).toBe(rawTokenFixture);
  expect(repository.lastWrite.tokenDigest).toBe(sha256(rawTokenFixture));
  expect(repository.lastWrite).not.toHaveProperty('rawToken');
  clock.advanceBy({ days: 8 });
  await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
});
```

- [ ] **Step 4: Run the primitive tests and verify red**

Run: `pnpm --filter @easygenerator/api test -- password.service.spec.ts csrf.service.spec.ts session.service.spec.ts`

Expected: FAIL because the services and schemas do not exist.

- [ ] **Step 5: Implement persistence schemas and indexes**

Create the unique `emailKey` index, unique `tokenDigest` index, session TTL index on `expiresAt`, and audit indexes on `{createdAt:-1}`, `{actorId:1,createdAt:-1}`, and `{targetId:1,createdAt:-1}`. Mark `passwordHash` as `select:false`. Configure user optimistic concurrency and timestamps.

- [ ] **Step 6: Implement cryptographic services**

Use explicit Argon2id options. Generate sessions with `randomBytes(32).toString('base64url')`; digest with SHA-256. Use HMAC-SHA-256 for CSRF and constant-time comparison after equal-length checks. Inject a clock and random source behind small tokens in tests; production adapters use `Date` and `node:crypto`.

- [ ] **Step 7: Implement safe service and audit boundaries**

`UsersService` returns mapped safe users and exposes the password hash only through `findForAuthentication(emailKey)`. `AuditService.record` accepts an allowlisted event union, not arbitrary metadata:

```ts
type AuditInput =
  | { action: 'AUTH_SIGNUP_SUCCEEDED'; actorId: string; requestId: string }
  | { action: 'AUTH_SIGNIN_SUCCEEDED'; actorId: string; requestId: string }
  | { action: 'AUTH_SIGNIN_FAILED'; identityDigest: string; requestId: string }
  | { action: 'AUTH_LOGOUT_SUCCEEDED'; actorId: string; requestId: string }
  | { action: 'SESSION_REJECTED'; actorId: string | null; reason: 'EXPIRED' | 'REVOKED' | 'DISABLED'; requestId: string }
  | { action: 'USER_ROLE_CHANGED'; actorId: string; targetId: string; from: Role; to: Role; requestId: string }
  | { action: 'USER_STATUS_CHANGED'; actorId: string; targetId: string; from: UserStatus; to: UserStatus; requestId: string }
  | { action: 'ASSISTANT_REFUSED'; actorId: string; reason: 'INSUFFICIENT_DOCUMENTATION' | 'RATE_LIMITED'; requestId: string };
```

- [ ] **Step 8: Verify unit tests and index definitions**

Run:

```bash
pnpm --filter @easygenerator/api test
pnpm --filter @easygenerator/api typecheck
```

Expected: PASS; snapshot/index assertions show no raw-session or non-unique email storage.

- [ ] **Step 9: Commit auth primitives**

```bash
git add apps/api/src/modules apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add secure identity and session primitives"
```

---

### Task 5: Deliver the complete authentication API

**Files:**
- Create: `apps/api/src/platform/redis/rate-limiter.service.ts`
- Create: `apps/api/src/platform/redis/rate-limiter.service.spec.ts`
- Create: `apps/api/src/modules/auth/auth.constants.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.service.spec.ts`
- Create: `apps/api/src/modules/auth/current-principal.decorator.ts`
- Create: `apps/api/src/modules/auth/session.guard.ts`
- Create: `apps/api/src/modules/auth/csrf.guard.ts`
- Create: `apps/api/src/modules/auth/cookie.service.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/test/integration/auth.integration.spec.ts`
- Create: `apps/api/test/support/create-test-app.ts`
- Create: `apps/api/test/support/reset-datastores.ts`
- Create: `apps/api/vitest.integration.config.ts`
- Create: `compose.test.yaml`
- Create: `scripts/run-integration-tests.mjs`
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: shared auth schemas and Task 4 primitives.
- Produces: signup, signin, session, logout, and protected current-user endpoints; `SessionGuard`; `CsrfGuard`; atomic Redis fixed-window limiter.

```ts
interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}
```

- [ ] **Step 1: Write failing auth-service tests**

```ts
it('creates only a USER and returns a new session', async () => {
  const result = await service.signUp(signupInput, requestContext);
  expect(users.createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'USER', status: 'ACTIVE' }));
  expect(result.user).not.toHaveProperty('passwordHash');
  expect(result.rawSessionToken).toBeDefined();
});

it.each(['missing@example.com', 'disabled@example.com'])('uses the same signin error for %s', async (email) => {
  await expect(service.signIn({ email, password: 'Wrong1!' }, requestContext))
    .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
});
```

- [ ] **Step 2: Write failing HTTP integration tests**

Create `compose.test.yaml` with MongoDB 8 on host port `27018`, `--replSet rs0 --bind_ip_all`, an idempotent one-shot `mongo-init-test`, and Redis 8 on host port `6380`. Use no persistent volumes. `scripts/run-integration-tests.mjs` must start the file with `docker compose up --wait`, run Vitest with these fixed test-only values, and always call `docker compose down --volumes` in `finally`:

```text
MONGODB_URI=mongodb://127.0.0.1:27018/easygenerator_auth_test?replicaSet=rs0&directConnection=true
DB_NAME=easygenerator_auth_test
REDIS_URL=redis://127.0.0.1:6380
APP_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
```

Add API scripts `test:integration` for the runner and `test:integration:run` for `vitest run --config vitest.integration.config.ts`. The runner exits with the Vitest status even when cleanup also fails.

```ts
it('signs up, restores the session, reaches the protected endpoint, and logs out', async () => {
  const agent = request.agent(app.getHttpServer());
  const signup = await agent.post('/api/v1/auth/signup')
    .set('Origin', appOrigin)
    .send({ email: 'ada@example.com', name: 'Ada', password: 'Secure1!' })
    .expect(201);

  expect(signup.headers['set-cookie'][0]).toContain('HttpOnly');
  const csrf = signup.body.csrfToken;
  await agent.get('/api/v1/users/me').expect(200, expect.objectContaining({ email: 'ada@example.com' }));
  await agent.post('/api/v1/auth/logout').set('Origin', appOrigin).set('X-CSRF-Token', csrf).expect(204);
  await agent.get('/api/v1/users/me').expect(401);
});
```

Also write tests for invalid fields, unknown input keys, concurrent duplicate signup, generic signin failures, disabled users, missing/invalid Origin, missing/invalid CSRF, cookie attributes, expired sessions, Redis `503`, and `Retry-After`.

- [ ] **Step 3: Run focused tests and verify red**

Run:

```bash
pnpm --filter @easygenerator/api test -- auth.service.spec.ts rate-limiter.service.spec.ts
pnpm --filter @easygenerator/api test:integration -- auth.integration.spec.ts
```

Expected: FAIL because HTTP auth orchestration and guards are absent.

- [ ] **Step 4: Implement the atomic Redis limiter**

Use one Lua script to increment a namespaced key and set its expiry only on the first increment. HMAC normalized email using `IDENTITY_HASH_SECRET`; never place the raw email in Redis. Convert Redis errors to `503 AUTH_PROTECTION_UNAVAILABLE` for signup/signin.

- [ ] **Step 5: Implement authentication orchestration**

Normalize only `emailKey = email.trim().toLowerCase()`. Use the process-held dummy hash when the user is absent. Preserve generic failure behavior. Catch Mongo error code `11000` as `EMAIL_ALREADY_REGISTERED`. Create session and safe audit records; never log the request body.

- [ ] **Step 6: Implement cookie, session, Origin, and CSRF guards**

Production cookie options are exact:

```ts
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
} as const;
```

Development uses `session` and `secure:false`; production uses `__Host-session`. `SessionGuard` reads the cookie, resolves current MongoDB session/user state, and attaches a principal. `CsrfGuard` requires exact `Origin`, valid Fetch Metadata when present, and `X-CSRF-Token` on mutations.

- [ ] **Step 7: Implement controllers and protected endpoint**

Return `201` for signup, `200` for signin/session, and idempotent `204` for logout. Each auth-session response includes `{features:{assistant:config.assistantEnabled}}`; it never exposes model/provider details. Add `Cache-Control: no-store` to every auth/current-user response. `GET /api/v1/users/me` requires `SessionGuard` and returns only `SafeUser`.

- [ ] **Step 8: Run auth verification**

Run:

```bash
pnpm --filter @easygenerator/api test
pnpm --filter @easygenerator/api test:integration
pnpm --filter @easygenerator/api typecheck
```

Expected: PASS; the integration suite proves required signup/signin/protected/logout behavior and defensive cases.

- [ ] **Step 9: Commit the authentication API**

```bash
git add apps/api packages/contracts pnpm-lock.yaml
git commit -m "feat: deliver secure authentication API"
```

---

### Task 6: Build the accessible authentication frontend

**Files:**
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/api-client.test.ts`
- Create: `apps/web/src/app/query-client.ts`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/components/Button.tsx`
- Create: `apps/web/src/components/Field.tsx`
- Create: `apps/web/src/components/LoadingScreen.tsx`
- Create: `apps/web/src/components/PasswordField.tsx`
- Create: `apps/web/src/components/ProblemAlert.tsx`
- Create: `apps/web/src/features/auth/AuthProvider.tsx`
- Create: `apps/web/src/features/auth/AuthProvider.test.tsx`
- Create: `apps/web/src/features/auth/ProtectedRoute.tsx`
- Create: `apps/web/src/features/auth/auth-api.ts`
- Create: `apps/web/src/features/auth/SignInForm.tsx`
- Create: `apps/web/src/features/auth/SignInForm.test.tsx`
- Create: `apps/web/src/features/auth/SignUpForm.tsx`
- Create: `apps/web/src/features/auth/SignUpForm.test.tsx`
- Create: `apps/web/src/pages/ApplicationPage.tsx`
- Create: `apps/web/src/pages/NotFoundPage.tsx`
- Create: `apps/web/src/pages/SignInPage.tsx`
- Create: `apps/web/src/pages/SignUpPage.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/test/deferred.ts`
- Create: `apps/web/src/test/render-with-app.tsx`
- Create: `apps/web/src/test/server.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/index.css`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: Task 2 auth schemas and Task 5 endpoints.
- Produces: `apiClient.request<T>()`; `AuthProvider` with `{status,user,csrfToken,signIn,signUp,logout}`; public signin/signup routes; protected `/app`; exact welcome copy.

- [ ] **Step 1: Read the frontend-design skill before choosing concrete CSS details**

Use the already approved warm-neutral, deep-ink, restrained-indigo direction. Do not reopen product scope. Record the chosen token values in `tokens.css` and keep fonts local/system-only.

- [ ] **Step 2: Install focused UI dependencies**

Run:

```bash
pnpm --filter @easygenerator/web add @hookform/resolvers lucide-react react-hook-form
pnpm --filter @easygenerator/web add -D @tailwindcss/vite msw tailwindcss
```

- [ ] **Step 3: Write failing API-client and session-restoration tests**

```ts
it('uses same-origin credentials and maps problem details', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
  );
  await expect(apiClient.request('/api/v1/auth/session')).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
    requestId: 'req-1',
  });
  expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({ credentials: 'include' }));
});

it('does not render a protected route until restoration completes', async () => {
  const pendingSession = deferred<AuthSessionResponse>();
  renderWithApp(<ProtectedRoute><ApplicationPage /></ProtectedRoute>, { sessionPromise: pendingSession.promise });
  expect(screen.getByRole('status', { name: /restoring session/i })).toBeVisible();
  expect(screen.queryByText('Welcome to the application.')).not.toBeInTheDocument();
});
```

Use MSW for browser API tests and reset handlers after every test.

- [ ] **Step 4: Write failing form and navigation tests**

```ts
it('shows each password rule and signs up into the application', async () => {
  const user = userEvent.setup();
  renderWithApp(<SignUpForm />);
  await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
  await user.type(screen.getByLabelText(/^name/i), 'Ada');
  await user.type(screen.getByLabelText(/^password/i), 'Secure1!');
  expect(screen.getByText(/at least 8 characters/i)).toHaveAttribute('data-met', 'true');
  await user.click(screen.getByRole('button', { name: /create account/i }));
  expect(await screen.findByText('Welcome to the application.')).toBeVisible();
});
```

Also cover invalid email, short name, every password rule, show/hide, generic signin failure, `429` countdown, logout, keyboard submission, and focus moving to the problem alert.

- [ ] **Step 5: Run frontend tests and verify red**

Run: `pnpm --filter @easygenerator/web test`

Expected: FAIL because auth state, routes, and forms are not implemented.

- [ ] **Step 6: Implement the typed fetch client and auth state**

`apiClient` always uses `credentials:'include'`, validates successful JSON with the supplied Zod schema, parses problem details, and sends `X-CSRF-Token` only for mutations after authentication. It never retries signin/signup automatically.

`AuthProvider` calls `/auth/session` once, keeps the CSRF token only in memory, deduplicates restoration, clears state on `401`, and invalidates TanStack Query data after logout. No browser storage calls are permitted.

- [ ] **Step 7: Implement the approved auth experience**

Build a responsive split layout on desktop and a single-column mobile layout. Include semantic labels, `aria-describedby`, `aria-live` problem feedback, visible focus rings, 44px controls, reduced motion, autocomplete values (`email`, `name`, `current-password`, `new-password`), and no disabled submit button solely because fields are initially empty.

The application page must render:

```tsx
<h1>Welcome to the application.</h1>
```

along with safe identity, role badge, allowed navigation, and logout.

- [ ] **Step 8: Verify frontend behavior and accessibility basics**

Run:

```bash
pnpm --filter @easygenerator/web test
pnpm --filter @easygenerator/web typecheck
pnpm --filter @easygenerator/web build
```

Expected: PASS; tests prove no auth persistence and no protected-page flash.

- [ ] **Step 9: Commit the required full-stack user journey**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add accessible authentication experience"
```

---

### Task 7: Implement explicit RBAC and the admin API

**Files:**
- Create: `packages/contracts/src/admin.ts`
- Create: `packages/contracts/src/admin.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/admin/authorization.policy.ts`
- Create: `apps/api/src/modules/admin/authorization.policy.spec.ts`
- Create: `apps/api/src/modules/admin/capability.decorator.ts`
- Create: `apps/api/src/modules/admin/capability.guard.ts`
- Create: `apps/api/src/modules/admin/schemas/security-state.schema.ts`
- Create: `apps/api/src/modules/admin/admin.repository.ts`
- Create: `apps/api/src/modules/admin/admin.service.ts`
- Create: `apps/api/src/modules/admin/admin.controller.ts`
- Create: `apps/api/src/modules/admin/admin.module.ts`
- Create: `apps/api/src/modules/audit/audit.controller.ts`
- Create: `apps/api/src/cli/bootstrap-admin.ts`
- Create: `apps/api/test/integration/admin.integration.spec.ts`
- Modify: `apps/api/src/modules/audit/audit.module.ts`
- Modify: `apps/api/src/modules/auth/session.service.ts`
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: current principal/session, Mongoose transaction connection, audit service, and user version from Tasks 4–5.
- Produces: explicit capability policy, paginated admin endpoints, transactional role/status mutation, and one-time admin CLI.

```ts
export type Capability = 'USE_APP' | 'READ_USERS' | 'READ_AUDIT' | 'MANAGE_BASIC_USERS' | 'MANAGE_PRIVILEGED_USERS';

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
  version: number;
}

export interface UserPage {
  items: SafeUser[];
  page: number;
  pageSize: number;
  total: number;
  summary: { total: number; active: number };
}
```

- [ ] **Step 1: Write strict admin contract tests**

Validate `page` 1+, `pageSize` 1–50, search 0–100 characters, safe sort keys, at least one role/status change, required nonnegative `version`, and rejection of unknown fields.

- [ ] **Step 2: Write the complete failing policy matrix**

```ts
it.each([
  ['USER', 'READ_USERS', false],
  ['SUPPORT', 'READ_USERS', true],
  ['MANAGER', 'MANAGE_BASIC_USERS', true],
  ['MANAGER', 'MANAGE_PRIVILEGED_USERS', false],
  ['ADMIN', 'MANAGE_PRIVILEGED_USERS', true],
] as const)('%s / %s -> %s', (role, capability, allowed) => {
  expect(can(role, capability)).toBe(allowed);
});
```

Add actor/target cases proving managers cannot edit self/manager/admin, admins cannot alter self, and the final active admin is protected.

- [ ] **Step 3: Write failing integration tests for protected admin operations**

Cover support read-only access, manager basic mutation, manager escalation denial, admin privileged mutation, stale version, session revocation, audit creation, and two concurrent attempts to remove the last two active admins.

- [ ] **Step 4: Run focused tests and verify red**

Run:

```bash
pnpm --filter @easygenerator/contracts test -- admin.test.ts
pnpm --filter @easygenerator/api test -- authorization.policy.spec.ts
pnpm --filter @easygenerator/api test:integration -- admin.integration.spec.ts
```

Expected: FAIL because admin contracts and policies are absent.

- [ ] **Step 5: Implement default-deny capability and target policies**

Use exhaustive records keyed by `Role`; do not compare enum order. `CapabilityGuard` checks coarse access. `AdminService` repeats target-specific checks inside the database transaction so controller/guard mistakes cannot bypass them.

- [ ] **Step 6: Implement paginated, redacted reads**

Escape search text before building the MongoDB regex, select only safe user fields, cap page size at 50, and return stable sorting by `createdAt` then `_id`. Redact audit metadata through event-specific response mappers; never return identity digests to SUPPORT.

- [ ] **Step 7: Implement serialized administrative mutations**

Within `connection.transaction()`:

1. Read and increment the singleton security-state revision for every ADMIN membership change.
2. Re-read actor and target.
3. Enforce actor/target rules and expected user version.
4. Count active admins when the target currently or subsequently has ADMIN status.
5. Update the target with optimistic concurrency.
6. Revoke all target sessions.
7. Append the safe audit event.

Retry MongoDB transient transaction errors up to three times with bounded jitter; return `409` after exhausted write conflicts.

- [ ] **Step 8: Implement the explicit bootstrap command**

Add `pnpm --filter @easygenerator/api bootstrap:admin`. Require `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`; validate with the same signup schema; refuse if any admin exists or the email already exists; never print the password. The normal server startup never invokes this code.

- [ ] **Step 9: Verify admin behavior**

Run:

```bash
pnpm --filter @easygenerator/contracts test
pnpm --filter @easygenerator/api test
pnpm --filter @easygenerator/api test:integration
pnpm --filter @easygenerator/api typecheck
```

Expected: PASS, including concurrency and privilege-escalation cases.

- [ ] **Step 10: Commit RBAC and administration**

```bash
git add apps/api packages/contracts pnpm-lock.yaml
git commit -m "feat: add explicit role-based administration"
```

---

### Task 8: Build the permission-aware admin dashboard

**Files:**
- Create: `apps/web/src/features/admin/admin-api.ts`
- Create: `apps/web/src/features/admin/use-admin-users.ts`
- Create: `apps/web/src/features/admin/UserTable.tsx`
- Create: `apps/web/src/features/admin/UserTable.test.tsx`
- Create: `apps/web/src/features/admin/UserActionDialog.tsx`
- Create: `apps/web/src/features/admin/UserActionDialog.test.tsx`
- Create: `apps/web/src/features/admin/AuditTimeline.tsx`
- Create: `apps/web/src/features/admin/AdminDashboard.tsx`
- Create: `apps/web/src/features/admin/AdminDashboard.test.tsx`
- Create: `apps/web/src/features/auth/PermissionRoute.tsx`
- Create: `apps/web/src/pages/AccessDeniedPage.tsx`
- Create: `apps/web/src/pages/AdminPage.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/pages/ApplicationPage.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: Task 7 contracts/endpoints and Task 6 auth context/API client.
- Produces: `/admin` route; role-aware navigation; server-paginated user table; safe action dialog; audit timeline; stale-version recovery.

- [ ] **Step 1: Install accessible dialog dependency**

Run: `pnpm --filter @easygenerator/web add @radix-ui/react-dialog`

- [ ] **Step 2: Write failing permission and table tests**

```ts
it.each([
  ['USER', false],
  ['SUPPORT', true],
  ['MANAGER', true],
  ['ADMIN', true],
] as const)('shows admin navigation for %s: %s', (role, visible) => {
  renderApplication({ role });
  expect(Boolean(screen.queryByRole('link', { name: /administration/i }))).toBe(visible);
});

it('does not render manager controls for an ADMIN target', async () => {
  renderUserTable({ actorRole: 'MANAGER', targetRole: 'ADMIN' });
  expect(screen.queryByRole('button', { name: /change role/i })).not.toBeInTheDocument();
});
```

Add tests for search debounce, pagination, empty/error/retry states, confirmation copy, `409 STALE_USER_VERSION` refetch, and focus restoration after dialog close.

- [ ] **Step 3: Run dashboard tests and verify red**

Run: `pnpm --filter @easygenerator/web test -- AdminDashboard.test.tsx UserTable.test.tsx UserActionDialog.test.tsx`

Expected: FAIL because the dashboard is absent.

- [ ] **Step 4: Implement typed admin queries and mutations**

Put search/page in URL query parameters. Debounce search by 250 ms, cancel superseded requests, and keep prior page data while fetching. Include `version` on mutations. On success, invalidate user and audit queries; on stale conflict, close the dialog, refetch, and announce that the record changed.

- [ ] **Step 5: Implement focused responsive dashboard UI**

Render total/active summary cards, a desktop table, a mobile card list, status and role badges, permitted action menu, confirmation dialog describing the exact change, and redacted audit timeline. SUPPORT sees no mutation controls. The API remains authoritative if presentation logic is wrong.

- [ ] **Step 6: Verify dashboard behavior**

Run:

```bash
pnpm --filter @easygenerator/web test
pnpm --filter @easygenerator/web typecheck
pnpm --filter @easygenerator/web build
```

Expected: PASS with keyboard-accessible dialog/table controls and explicit forbidden/stale states.

- [ ] **Step 7: Commit the admin dashboard**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add permission-aware admin dashboard"
```

---

### Task 9: Implement grounded retrieval and the Gemini SSE API

**Files:**
- Create: `docs/assistant-public/overview.md`
- Create: `docs/assistant-public/architecture.md`
- Create: `docs/assistant-public/authentication.md`
- Create: `docs/assistant-public/authorization.md`
- Create: `docs/assistant-public/api.md`
- Create: `docs/assistant-public/deployment.md`
- Create: `packages/contracts/src/assistant.ts`
- Create: `packages/contracts/src/assistant.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/assistant/assistant.types.ts`
- Create: `apps/api/src/modules/assistant/document-loader.service.ts`
- Create: `apps/api/src/modules/assistant/document-loader.service.spec.ts`
- Create: `apps/api/src/modules/assistant/retriever.service.ts`
- Create: `apps/api/src/modules/assistant/retriever.service.spec.ts`
- Create: `apps/api/src/modules/assistant/gemini.provider.ts`
- Create: `apps/api/src/modules/assistant/gemini.provider.spec.ts`
- Create: `apps/api/src/modules/assistant/assistant-cache.service.ts`
- Create: `apps/api/src/modules/assistant/assistant-concurrency.service.ts`
- Create: `apps/api/src/modules/assistant/sse-writer.ts`
- Create: `apps/api/src/modules/assistant/sse-writer.spec.ts`
- Create: `apps/api/src/modules/assistant/assistant.service.ts`
- Create: `apps/api/src/modules/assistant/assistant.controller.ts`
- Create: `apps/api/src/modules/assistant/assistant.module.ts`
- Create: `apps/api/test/integration/assistant.integration.spec.ts`
- Modify: `apps/api/src/platform/config/config.schema.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: authenticated principal/CSRF guard, Redis limiter, public docs, and Task 3 configuration.
- Produces: deterministic retrieval, safe Gemini adapter, typed SSE, one-stream-per-user limit, versioned retrieval cache, and `POST /api/v1/assistant/chat`.

```ts
export interface RetrievedChunk {
  id: string;
  file: string;
  heading: string;
  content: string;
  coverage: number;
}

export interface AssistantProvider {
  stream(input: { system: string; contents: string; maxOutputTokens: number }, signal: AbortSignal): AsyncIterable<string>;
}
```

- [ ] **Step 1: Write the public-safe documentation corpus from implemented behavior**

Each file describes only committed behavior and contains stable headings suitable for citations. Do not copy `.env`, source code, user examples containing real identities, or private project details. State the assistant privacy boundary in `overview.md`.

- [ ] **Step 2: Install the current official Gemini SDK**

Run: `pnpm --filter @easygenerator/api add @google/genai`

- [ ] **Step 3: Write failing corpus and retrieval tests**

```ts
it('loads only direct Markdown files inside the allowlisted directory', async () => {
  const corpus = await loader.load();
  expect(corpus.every((chunk) => chunk.file.startsWith('docs/assistant-public/'))).toBe(true);
  expect(corpus.some((chunk) => chunk.content.includes('GEMINI_API_KEY'))).toBe(false);
});

it('refuses weak evidence before provider invocation', async () => {
  const result = retriever.search('What is the weather in Cairo?');
  expect(result).toEqual({ kind: 'refusal', reason: 'INSUFFICIENT_DOCUMENTATION' });
});
```

Test heading splitting, path traversal/symlink rejection, 40% meaningful-term coverage, one-term exact match, top-four limit, stable source IDs, and corpus digest changes.

- [ ] **Step 4: Write failing SSE and endpoint tests**

```ts
it('frames JSON without allowing event injection', () => {
  expect(encodeSse('delta', { text: 'hello\n\ndata: forged' })).toBe(
    'event: delta\ndata: {"text":"hello\\n\\ndata: forged"}\n\n',
  );
});

it('authenticates before streaming and cancels Gemini on disconnect', async () => {
  const response = await authenticatedChat('Explain sessions');
  expect(response.headers['content-type']).toContain('text/event-stream');
  response.destroy();
  await expect(provider.abortObserved).resolves.toBe(true);
});
```

Also test feature disabled as `404 ASSISTANT_DISABLED`, missing CSRF, assistant rate limit, one-stream concurrency, timeout, provider error, local refusal without provider call, source-first event, final `done`, and cache values containing only chunk IDs. Signup/signin/session responses expose only the boolean `features.assistant`, never provider configuration.

- [ ] **Step 5: Run focused tests and verify red**

Run:

```bash
pnpm --filter @easygenerator/contracts test -- assistant.test.ts
pnpm --filter @easygenerator/api test -- retriever.service.spec.ts sse-writer.spec.ts gemini.provider.spec.ts
pnpm --filter @easygenerator/api test:integration -- assistant.integration.spec.ts
```

Expected: FAIL because assistant boundaries do not exist.

- [ ] **Step 6: Implement allowlisted loading and deterministic retrieval**

Resolve the configured directory, reject symlinks and any resolved path outside it, read only direct `.md` files, split on Markdown headings, and compute a SHA-256 corpus digest. Tokenize lowercase Unicode words, remove the committed stop-word set, calculate unique-term coverage, boost exact headings, and apply the approved refusal rule exactly.

- [ ] **Step 7: Implement safe Redis cache and concurrency locks**

Cache key: `assistant:retrieval:<corpusDigest>:<sha256(normalizedQuery)>`; value: JSON array of safe chunk IDs; TTL: one hour. Acquire `assistant:active:<userId>` using `SET token NX EX 35`; release through a compare-and-delete Lua script so one request cannot release another request's lock.

- [ ] **Step 8: Implement Gemini adapter and bounded prompt**

Instantiate `GoogleGenAI` only when enabled. Require `GEMINI_API_KEY` and `GEMINI_MODEL`; call `ai.models.generateContentStream` with model from configuration, `maxOutputTokens:800`, no tools, and the provided abort signal. Delimit sources as inert quoted material and require source-number citations. Map provider text only; never log SDK request/response bodies.

- [ ] **Step 9: Implement authenticated fetch-based SSE**

Validate `{message, history}` with the shared schema, return `404 ASSISTANT_DISABLED` before provider initialization when disabled, authenticate and authorize before setting stream headers, require CSRF/Origin, rate limit 10/minute/user, acquire concurrency, retrieve evidence, and locally refuse if insufficient. Emit JSON `sources`, `delta`, `done`, or `error`; never include stack/provider details. Set `Cache-Control: no-store, no-transform`, flush headers, abort on request close, enforce 30 seconds, and always release the Redis lock in `finally`.

- [ ] **Step 10: Verify the assistant backend**

Run:

```bash
pnpm --filter @easygenerator/contracts test
pnpm --filter @easygenerator/api test
pnpm --filter @easygenerator/api test:integration
pnpm --filter @easygenerator/api typecheck
```

Expected: PASS with `ASSISTANT_ENABLED=false` and no Gemini network call.

- [ ] **Step 11: Commit the isolated assistant backend**

```bash
git add apps/api packages/contracts docs/assistant-public pnpm-lock.yaml
git commit -m "feat: add grounded Gemini streaming API"
```

---

### Task 10: Build the safe streaming assistant UI

**Files:**
- Create: `apps/web/src/features/assistant/parse-event-stream.ts`
- Create: `apps/web/src/features/assistant/parse-event-stream.test.ts`
- Create: `apps/web/src/features/assistant/assistant-api.ts`
- Create: `apps/web/src/features/assistant/use-assistant-stream.ts`
- Create: `apps/web/src/features/assistant/AssistantChat.tsx`
- Create: `apps/web/src/features/assistant/AssistantChat.test.tsx`
- Create: `apps/web/src/features/assistant/SourceCards.tsx`
- Create: `apps/web/src/features/assistant/SafeMarkdown.tsx`
- Create: `apps/web/src/features/assistant/SafeMarkdown.test.tsx`
- Create: `apps/web/src/pages/AssistantPage.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/pages/ApplicationPage.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: Task 9 typed events and Task 6 auth/API state.
- Produces: `/assistant` route, incremental stream parsing, cancellation, bounded in-memory history, safe Markdown, source cards, privacy/disabled/refusal states.

- [ ] **Step 1: Install safe Markdown dependencies**

Run: `pnpm --filter @easygenerator/web add react-markdown rehype-sanitize remark-gfm`

- [ ] **Step 2: Write a failing fragmented-stream parser test**

```ts
it('parses events split across arbitrary network chunks', async () => {
  const chunks = ['event: sou', 'rces\ndata: {"sources":[', '"auth"]}\n\nevent: delta\ndata: {"text":"Hi"}\n\n'];
  await expect(collect(parseEventStream(streamOf(chunks)))).resolves.toEqual([
    { type: 'sources', data: { sources: ['auth'] } },
    { type: 'delta', data: { text: 'Hi' } },
  ]);
});
```

Test CRLF, multiple events per chunk, UTF-8 split boundaries, malformed JSON as a safe protocol error, and EOF without a final blank line.

- [ ] **Step 3: Write failing chat and sanitization tests**

Prove incremental rendering, stop-generation abort, one in-flight request, six-message history cap, local privacy warning, documented refusal, retryable network error, source rendering, raw HTML removal, and rejection of `javascript:` links.

- [ ] **Step 4: Run assistant UI tests and verify red**

Run: `pnpm --filter @easygenerator/web test -- parse-event-stream.test.ts AssistantChat.test.tsx SafeMarkdown.test.tsx`

Expected: FAIL because the stream UI is absent.

- [ ] **Step 5: Implement POST streaming client and hook**

Use `fetch('/api/v1/assistant/chat', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf}, body, signal})`. Check status/problem JSON before parsing the stream. Never place prompt or credential material in the URL. Keep history in React state only and abort during unmount/logout.

- [ ] **Step 6: Implement the approved assistant experience**

Render a clear empty state with suggested documentation questions, privacy notice, user/assistant bubbles, streaming cursor, stop button, source cards, refusal message, disabled-feature message, and `aria-live` status that does not announce every token. Disable only the send action while one stream is active; keep cancellation keyboard accessible.

- [ ] **Step 7: Verify web assistant and full web suite**

Run:

```bash
pnpm --filter @easygenerator/web test
pnpm --filter @easygenerator/web typecheck
pnpm --filter @easygenerator/web build
```

Expected: PASS with safe Markdown and robust fragmented parsing.

- [ ] **Step 8: Commit the assistant UI**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add grounded streaming assistant UI"
```

---

### Task 11: Add OpenAPI, end-to-end tests, and production hardening

**Files:**
- Create: `apps/api/src/platform/http/openapi.ts`
- Create: `apps/api/test/integration/openapi.integration.spec.ts`
- Create: `apps/web/src/test/accessibility.test.tsx`
- Create: `playwright.config.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/admin.spec.ts`
- Create: `e2e/fixtures.ts`
- Create: `scripts/run-e2e.mjs`
- Modify: `apps/api/src/main.ts`
- Modify: API controllers under `apps/api/src/modules/`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: root `package.json`

**Interfaces:**
- Consumes: all completed API and web behavior.
- Produces: `/api/docs`, `/api/docs-json`, accessibility regression checks, and browser-level recruiter journeys.

- [ ] **Step 1: Install documentation and browser-test dependencies**

Run:

```bash
pnpm --filter @easygenerator/api add @nestjs/swagger
pnpm --filter @easygenerator/web add -D axe-core vitest-axe
pnpm add -Dw @playwright/test
pnpm exec playwright install chromium
```

Add root script `"e2e": "node scripts/run-e2e.mjs"`.

- [ ] **Step 2: Write a failing OpenAPI contract test**

```ts
it('documents required endpoints without password/session response fields', async () => {
  const document = createOpenApiDocument(app);
  expect(document.paths).toHaveProperty('/api/v1/auth/signup');
  expect(document.paths).toHaveProperty('/api/v1/users/me');
  expect(JSON.stringify(document.components)).not.toContain('passwordHash');
  expect(JSON.stringify(document.components)).not.toContain('tokenDigest');
});
```

- [ ] **Step 3: Write failing browser and accessibility tests**

```ts
test('required authentication journey', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Name').fill('Ada Tester');
  await page.getByLabel('Password').fill('Secure1!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to the application.' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/signin$/);
});
```

The admin journey signs in with a CI-created admin, updates a USER, verifies its audit event, and proves a manager cannot promote to ADMIN.

- [ ] **Step 4: Run focused checks and verify red**

Run:

```bash
pnpm --filter @easygenerator/api test:integration -- openapi.integration.spec.ts
pnpm --filter @easygenerator/web test -- accessibility.test.tsx
pnpm e2e -- e2e/auth.spec.ts
```

Expected: FAIL because OpenAPI setup, axe assertions, and E2E harness are incomplete.

- [ ] **Step 5: Implement Swagger from shared Zod schemas**

Use Zod 4 JSON-schema output in small `@ApiBody`/`@ApiResponse` helpers, then Nest's `SwaggerModule`. Document cookie auth, `X-CSRF-Token`, stable problem responses, pagination, and SSE event examples. Enable UI/JSON only when `SWAGGER_ENABLED=true`; set it true for the recruiter deployment. Apply Swagger's required inline script/style CSP only to `/api/docs`, while the SPA and all other routes retain the strict application CSP.

- [ ] **Step 6: Implement deterministic E2E setup**

`scripts/run-e2e.mjs` starts `compose.test.yaml`, waits for MongoDB/Redis, clears only `easygenerator_auth_test`, bootstraps an admin with fixed test-only credentials, invokes Playwright, and tears dependencies down in `finally`. `playwright.config.ts` starts the API and Vite through two `webServer` entries using the same test-only connection values, captures traces/screenshots only on failure, and uses Chromium. Never use Atlas or the real Gemini key in E2E.

- [ ] **Step 7: Run complete local quality gate**

Run:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @easygenerator/api test:integration
pnpm build
pnpm e2e
```

Expected: every command exits `0`; no axe serious/critical violations; required and admin journeys pass.

- [ ] **Step 8: Commit documentation and E2E hardening**

```bash
git add apps e2e package.json playwright.config.ts pnpm-lock.yaml
git commit -m "test: add API documentation and end-to-end coverage"
```

---

### Task 12: Package, document, automate, and deploy the submission

**Files:**
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `.github/dependabot.yml`
- Create: `.github/pull_request_template.md`
- Create: `.github/workflows/ci.yml`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `render.yaml`
- Create: `README.md`
- Create: `AI.md`
- Create: `docs/SECURITY.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `scripts/post-deploy-smoke.mjs`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify: root `package.json`

**Interfaces:**
- Consumes: the complete tested application.
- Produces: non-root production image, local MongoDB-replica-set/Redis stack, GitHub quality gate, CI-gated Render Blueprint, operational docs, required AI disclosure, public repository, and live URL.

- [ ] **Step 1: Write a failing production-package smoke script**

```js
// scripts/post-deploy-smoke.mjs
const origin = new URL(process.env.SMOKE_ORIGIN);
const live = await fetch(new URL('/health/live', origin));
const denied = await fetch(new URL('/api/v1/users/me', origin));
if (!live.ok || denied.status !== 401) process.exitCode = 1;
```

Add assertions for `/`, `/health/ready`, and no accidental secret-shaped strings in public response bodies.

- [ ] **Step 2: Create the pinned multi-stage Docker image**

Run `pnpm --filter @easygenerator/api add @nestjs/serve-static`, then mount the built SPA only in production, excluding `/api*` and `/health*`; unknown non-API routes return `index.html`. Use `node:24.18.0-bookworm-slim` for dependency/build stages, install `pnpm@11.0.6`, use `pnpm install --frozen-lockfile`, build contracts/web/API, prune dev dependencies, copy only runtime artifacts and `docs/assistant-public`, create an unprivileged UID/GID, and run Nest with `NODE_ENV=production`. Install `tini` in the runtime image and use it as the exec-form entrypoint so termination signals reach Node.

- [ ] **Step 3: Create local Compose dependencies**

Define:

- MongoDB 8 with `--replSet rs0 --bind_ip_all`, health check, and a one-shot `mongo-init` that idempotently calls `rs.initiate()`.
- Redis 8 with health check and no published production assumptions.
- Application service built from the Dockerfile and dependent on healthy Mongo/Redis.

Use named volumes only for local development. Bind the app to `localhost:3000` and keep all example credentials non-production.

- [ ] **Step 4: Create the current Render Blueprint**

Use the supported 2026 fields:

```yaml
services:
  - type: keyvalue
    name: easygenerator-cache
    plan: starter
    region: frankfurt
    ipAllowList: []
    maxmemoryPolicy: noeviction
    persistenceMode: off

  - type: web
    name: easygenerator-auth
    runtime: docker
    plan: starter
    region: frankfurt
    branch: main
    autoDeployTrigger: checksPass
    healthCheckPath: /health/live
    envVars:
      - key: REDIS_URL
        fromService:
          type: keyvalue
          name: easygenerator-cache
          property: connectionString
      - key: CSRF_SECRET
        generateValue: true
      - key: IDENTITY_HASH_SECRET
        generateValue: true
      - key: MONGODB_URI
        sync: false
      - key: GEMINI_API_KEY
        sync: false
```

Use `noeviction` so memory pressure causes cache/limit writes to fail closed instead of silently evicting authentication throttles. Add the non-secret production values explicitly in the Blueprint: `DB_NAME=easygenerator_auth`, `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`, `SWAGGER_ENABLED=true`, `ASSISTANT_ENABLED=true`, `GEMINI_MODEL=gemini-3.5-flash`, and `LOG_LEVEL=info`. Resolve the exact HTTPS origin from Render's validated `RENDER_EXTERNAL_HOSTNAME`; an explicit `APP_ORIGIN` overrides it for a later custom domain.

- [ ] **Step 5: Create GitHub CI and dependency maintenance**

CI uses Node 24.18.0, pnpm 11.0.6, pnpm cache, and the checked-in `compose.test.yaml` for disposable MongoDB replica-set/Redis dependencies. It defines these required jobs:

```text
quality: format check, lint, typecheck
unit: contracts, API, and web tests with coverage report
integration: MongoDB/Redis API integration tests
build: production workspace build and Docker build
browser: Playwright Chromium journey
```

Set job timeouts, least-privilege `contents:read`, cancellation concurrency by branch, and no Gemini/Atlas secrets. Make Render wait for all checks through `autoDeployTrigger: checksPass`. Configure monthly grouped Dependabot updates for pnpm and GitHub Actions.

- [ ] **Step 6: Write operational and reviewer documentation**

Create `.env.example` with every supported key and safe local values only: `NODE_ENV`, `PORT`, `MONGODB_URI`, `DB_NAME`, `REDIS_URL`, `CSRF_SECRET`, `IDENTITY_HASH_SECRET`, `APP_ORIGIN`, `COOKIE_SECURE`, `TRUST_PROXY_HOPS`, `LOG_LEVEL`, `SWAGGER_ENABLED`, `ASSISTANT_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`. Leave secret values empty or use explicit development-only base64 samples that the production validator rejects.

`README.md` includes the live URL, architecture diagram in text, prerequisites, five-minute local setup, environment table, scripts, Docker workflow, Swagger URL, test matrix, role matrix, admin bootstrap, deployment, security summary, tradeoffs, and repository structure.

`docs/SECURITY.md` documents assets, trust boundaries, opaque sessions, CSRF, authorization invariants, rate limiting, Gemini privacy, secret handling, known non-goals, and a vulnerability-reporting contact method.

`docs/ARCHITECTURE.md` documents the modular monolith, module dependency rules, request/session flow, admin transaction, assistant retrieval/stream flow, and why JWT/microservices/vector storage were rejected.

`AI.md` truthfully records:

- AI-assisted planning, scaffolding guidance, validation/security test generation, documentation, and review.
- The effective independent-review prompt that asked for browser behavior, security, scope, and failure-mode challenges.
- Corrections from access/refresh JWTs to opaque sessions, native EventSource to POST fetch streaming, and arbitrary source context to a public-document allowlist.
- Every implementation output that required manual correction during execution, with the verification command used afterward.
- Developer-owned decisions and remaining limitations; no claim that unreviewed generated code was accepted.

- [ ] **Step 7: Verify local production packaging before any external deployment**

Run:

```bash
docker compose config
docker compose build
docker compose up --wait
SMOKE_ORIGIN=http://localhost:3000 node scripts/post-deploy-smoke.mjs
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @easygenerator/api test:integration
pnpm build
pnpm e2e
git diff --check
```

Expected: all commands exit `0`; local readiness is healthy, protected endpoint returns `401`, and the full browser journey passes.

- [ ] **Step 8: Commit the production delivery layer**

```bash
git add .dockerignore .env.example .github Dockerfile compose.yaml render.yaml README.md AI.md docs scripts package.json pnpm-lock.yaml
git commit -m "chore: add production delivery and documentation"
```

- [ ] **Step 9: Create and push the public GitHub repository**

After verifying `git status --short` is clean and `git grep` finds no secrets, run with the user's chosen repository name:

```bash
gh repo create easygenerator-auth-platform --public --source=. --remote=origin --push
```

Enable branch protection for `main`: require pull requests, require the five CI checks, require branches to be up to date, block force pushes/deletion, and enable secret scanning/Dependabot alerts where the account supports them.

- [ ] **Step 10: Provision production without copying secrets into commands or logs**

In MongoDB Atlas, create or select the approved cluster, create the `easygenerator_auth` database through the application's first write, create a least-privilege database user, and configure network access for Render. In Render, create the Blueprint from the GitHub repository, enter `MONGODB_URI` and `GEMINI_API_KEY` only in the secret prompts, verify Key Value uses the private connection string, and set the exact HTTPS `APP_ORIGIN` after Render assigns the hostname.

- [ ] **Step 11: Bootstrap the production admin and verify deployment**

Run the one-time admin command from Render's secure shell with credentials entered as temporary environment values, then unset those values. Do not show them in screenshots or README. Set the task-specific local variable `EG_DEPLOY_ORIGIN` to the exact HTTPS URL assigned by Render, then verify:

```bash
SMOKE_ORIGIN="$EG_DEPLOY_ORIGIN" node scripts/post-deploy-smoke.mjs
```

Manually exercise signup, automatic signin, refresh restoration, protected welcome, logout/signin, admin user update/audit, assistant citation/refusal, and mobile layout. Confirm logs contain request IDs but no email/password/cookie/token/prompt secrets.

- [ ] **Step 12: Record final evidence and commit only URL/documentation adjustments**

Update README badges and live URL, record the actual tested commit SHA and verification commands in `AI.md`, rerun `pnpm format:check` and `git diff --check`, then commit:

```bash
git add README.md AI.md
git commit -m "docs: publish live demo and verification evidence"
git push origin main
```

Expected final state: GitHub Actions is green, Render shows the same commit as healthy, the public URL passes the smoke script, the worktree is clean, and no secret appears in Git history.

---

## Final verification matrix

| Requirement | Evidence |
|---|---|
| React and TypeScript frontend | Web build, typecheck, component tests |
| NestJS and MongoDB backend | API build, Atlas/local integration tests |
| Signup field rules | Shared-schema table tests and browser journey |
| Signin | Generic-failure integration tests and browser journey |
| Protected application page | `GET /users/me` denial/success tests and exact welcome heading |
| Secure sessions/logout | Cookie, CSRF, expiry, restore, revocation tests |
| Four roles/admin dashboard | Full policy matrix, concurrent last-admin test, dashboard tests |
| Redis | Atomic limiter, concurrency lock, outage behavior tests |
| Gemini SSE assistant | Allowlist, retrieval/refusal, SSE framing/cancel, safe-render tests |
| Error handling/logging | Problem schema, redaction tests, request IDs |
| API documentation | OpenAPI path and sensitive-schema regression test |
| Docker and local setup | `docker compose config/build/up --wait` and smoke script |
| CI/CD | Required green GitHub checks and Render checks-pass deploy |
| README and AI.md | Reviewer checklist plus public files |
| Live submission | Public GitHub URL and healthy Render URL |

## References used while planning

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [NestJS MongoDB integration](https://docs.nestjs.com/techniques/mongodb)
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [Gemini JavaScript streaming](https://ai.google.dev/gemini-api/docs/generate-content/text-generation)
- [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render Key Value](https://render.com/docs/key-value)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
