# EasyGenerator Auth Platform

A production-oriented TypeScript modular monolith demonstrating secure signup,
signin, opaque server-side sessions, four-role administration, audit summaries,
Redis-backed protection, and an optional Gemini documentation assistant streamed
over authenticated POST SSE.

Repository: [moemisri/easygenerator-auth-platform](https://github.com/moemisri/easygenerator-auth-platform)

Live URL: Render provisioning is pending the account-owned Atlas URI and
security-secret inputs.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fmoemisri%2Feasygenerator-auth-platform)

## Architecture

```text
React/Vite browser (same origin)
        |
        v
NestJS HTTP boundary -- shared Zod contracts
   |            |             |
MongoDB      Redis       Gemini (optional)
users,       limits,     public-doc excerpts
sessions,    leases      only
audit
```

The production container serves the Vite output and Nest API from one origin.
JSON APIs use `/api/v1`; health endpoints use `/health/*`. See
[architecture](docs/ARCHITECTURE.md) and [security](docs/SECURITY.md).

## Prerequisites

- Node.js `24.18.0`
- pnpm `11.0.6`
- Docker Desktop with Compose v2

## Five-minute development setup

```bash
pnpm install --frozen-lockfile
docker compose -f compose.test.yaml up --wait
docker compose -f compose.test.yaml run --rm mongo-init-test
pnpm env:local
set -a
. ./.env.local
set +a
pnpm dev
```

The React development server is `http://localhost:5173`; it proxies API and
health requests to Nest on port `3000`. This is the interactive local auth
workflow. Stop disposable dependencies with:

```bash
docker compose -f compose.test.yaml down --volumes
```

## Configuration

The setup creates `.env.local` only when the operator runs `pnpm env:local`,
fills only blank CSRF/identity fields with distinct random 32-byte base64
values, preserves nonblank fields, and prints no values. Provide local overrides
without committing them. The application itself deliberately
ignores env files; export values through your process manager or use Compose's
`--env-file .env.local`.
For the interactive setup above, use the test-stack ports in `.env.local`:
MongoDB on `127.0.0.1:27018` with replica set `rs0`, Redis on
`127.0.0.1:6380`, and `DB_NAME=easygenerator_auth`.

| Variable                                      | Purpose                                                | Required in production          |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| `NODE_ENV`, `PORT`                            | Runtime mode and listener                              | yes / platform port             |
| `MONGODB_URI`, `DB_NAME`                      | Mongo connection and isolated database                 | yes; DB is `easygenerator_auth` |
| `REDIS_URL`                                   | protection/cache service                               | yes                             |
| `CSRF_SECRET`, `IDENTITY_HASH_SECRET`         | canonical base64 keys, 32+ decoded bytes               | yes                             |
| `APP_ORIGIN`                                  | exact same origin; otherwise validated Render hostname | one source required             |
| `COOKIE_SECURE`, `TRUST_PROXY_HOPS`           | cookie and proxy boundary                              | secure / explicit               |
| `LOG_LEVEL`, `SWAGGER_ENABLED`                | safe logging and docs switch                           | yes / optional                  |
| `ASSISTANT_ENABLED`                           | assistant feature gate                                 | optional                        |
| `GEMINI_API_KEY`, `GEMINI_MODEL`              | server-only provider settings                          | when assistant enabled          |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | one-time bootstrap input                               | bootstrap only                  |

The Blueprint requires both security keys as secret dashboard inputs. The
account holder must enter a canonical base64 value representing at least 32
random bytes for each secret in Render's secure UI before the first deployment.
Never place those values in the Blueprint, repository, terminal history, or CI.

## Commands and tests

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @easygenerator/api test:integration
pnpm build
pnpm e2e
node scripts/scan-secrets.mjs --tracked
node scripts/scan-secrets.mjs --reachable HEAD
node scripts/validate-render-blueprint.mjs
```

The matrix covers contracts, API units, React components/accessibility, real
Mongo replica-set and Redis integration, Chromium journeys, compiled Node ESM,
production SPA routing, delivery policy, smoke behavior, and secret scanning.

When `SWAGGER_ENABLED=true`, OpenAPI UI is at `/api/docs` and JSON at
`/api/docs-json`. Swagger remains subject to its narrow CSP exception.

## Docker workflows

`compose.yaml` builds the production image with local Mongo/Redis and exposes
only `127.0.0.1:3000`. It intentionally keeps production HTTPS-origin and secure
cookie validation intact, so its plain-HTTP path is for unauthenticated image,
health, and smoke verification—not interactive cookie authentication.

```bash
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local build
docker compose --env-file .env.local up --wait
SMOKE_ORIGIN=http://localhost:3000 node scripts/post-deploy-smoke.mjs
docker compose --env-file .env.local down --volumes
```

## Roles

| Role      | Application | List users / audit | Manage users                                  |
| --------- | ----------- | ------------------ | --------------------------------------------- |
| `USER`    | yes         | no                 | no                                            |
| `SUPPORT` | yes         | yes                | no                                            |
| `MANAGER` | yes         | yes                | basic users only                              |
| `ADMIN`   | yes         | yes                | privileged, except self/last-admin invariants |

## One-time administrator bootstrap

Build first, then supply temporary values only in a trusted shell and run the
compiled command. It fails if an administrator or matching email already
exists.

```bash
pnpm build
pnpm --filter @easygenerator/api bootstrap:admin
```

The final container deliberately includes minimal pnpm workspace metadata, so
that exact filtered command works in Render's secure shell without source or
`tsx`. Unset bootstrap variables immediately afterward.

## Deployment sequence

1. Merge through the five required checks: `quality`, `unit`, `integration`,
   `build`, and `browser`.
2. With account-holder approval, connect the public GitHub repository to the
   reviewed `render.yaml` Blueprint.
3. Enter the Atlas URI and both security keys only in Render's secure UI. The
   first release uses a new empty Redis instance. The assessment Blueprint
   keeps the assistant disabled, so Gemini values are needed only if the
   feature is enabled later.
4. Run the smoke script against the assigned HTTPS origin, then perform the
   one-time admin bootstrap and manual release checklist.

The public repository is available above. Render provisioning remains an
account-holder operation because production credentials are entered only in
Render's secure UI.

## Security and tradeoffs

Passwords use Argon2; sessions are opaque and server-side; state changes require
same-origin evidence and CSRF; role/capability decisions fail closed; Redis
protection outages deny sensitive writes; logs and errors use explicit safe
fields. The assistant is restricted to committed public documents and does not
persist conversations. See [SECURITY.md](docs/SECURITY.md).

This submission keeps one modular monolith and lexical retrieval to fit a
few-hour assessment and simple operational model. It deliberately avoids JWT
refresh flows, microservices, vector storage, email verification, password
reset, and MFA; those product workflows require separate threat modeling.

## Repository map

```text
apps/api                 NestJS API and CLI
apps/web                 React/Vite browser
packages/contracts       shared runtime schemas
docs/assistant-public    public-safe assistant corpus
docs                     architecture and security notes
e2e                      Chromium journeys
scripts                  deterministic runners and scanners
```
