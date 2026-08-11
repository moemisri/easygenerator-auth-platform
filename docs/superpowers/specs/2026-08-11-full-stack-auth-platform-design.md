# Full-Stack Authentication Platform Design

**Date:** 2026-08-11  
**Status:** Approved in conversation  
**Delivery target:** End of day, with a public GitHub repository and live deployment

## 1. Purpose

Build a production-oriented authentication application that satisfies the Easygenerator full-stack assessment and demonstrates senior engineering judgment through security, maintainability, testing, operations, and clear documentation.

The required authentication flow is the primary deliverable. Four-role authorization, a focused admin dashboard, Redis-backed protections, and a documentation-grounded Gemini assistant add useful depth without changing the core application's reliability.

## 2. Success criteria

The submission is successful when:

- A user can sign up with a valid email, a trimmed name of at least three characters, and a password containing at least eight characters, one letter, one number, and one special character.
- A successful signup creates a `USER` account, starts a session, and opens the protected application.
- A user can sign in, restore a session after a reload or browser restart, access the protected page, and log out.
- The protected page displays the exact text `Welcome to the application.`
- Server-side authorization enforces the four approved roles and target-level restrictions.
- Authorized staff can use a focused user-management dashboard and inspect redacted audit events.
- Authenticated users can ask the optional assistant questions about curated public project documentation and receive streamed, cited answers or a grounded refusal.
- MongoDB Atlas uses a new database on the existing approved connection; no existing database or collection is modified.
- Redis provides distributed rate limiting, assistant concurrency control, and retrieval caching without becoming authorization truth.
- The repository runs locally with Docker Compose, passes CI, deploys from GitHub to Render only after checks pass, and exposes a stable live demo.
- `README.md` and the required `AI.md` make setup, architecture, deployment, testing, and AI-assisted decisions easy to evaluate.

## 3. Scope and priorities

Implementation priority is fixed:

1. Repository foundation and deployable vertical slice.
2. Secure signup, signin, session restoration, protected page, and logout.
3. Explicit RBAC, audit events, and admin user management.
4. Test suite, operational controls, CI, Docker, documentation, and live deployment.
5. Redis-backed Gemini assistant as the final, feature-flagged milestone.

If delivery time becomes constrained, the assistant may be disabled, but the required authentication and authorization system must remain complete, tested, documented, and deployed.

### Non-goals for this assessment

- Microservices, Kubernetes, or independent frontend/API deployments
- Password reset, email verification, passkeys, MFA, or account recovery
- Persistent chat history or cross-device conversation sync
- User-uploaded documents, vector databases, embeddings, or arbitrary repository ingestion
- Sending source code, user data, environment data, or secrets to Gemini
- Caching generated answers or personalized prompts
- Building a general-purpose analytics or content-management dashboard

These are documented follow-up capabilities, not partially implemented features.

## 4. Architecture

Use a TypeScript pnpm-workspace monorepo:

```text
apps/
  api/          NestJS application
  web/          React and Vite application
packages/
  contracts/    Shared runtime schemas and inferred API types
docs/
  assistant-public/  Explicit Gemini-safe documentation allowlist
  superpowers/       Design and implementation planning documents
```

The NestJS API is a modular monolith with the following modules:

- `auth`: signup, signin, session restoration, CSRF issuance, and logout
- `users`: current-user profile and the assessment's protected endpoint
- `admin`: user directory, role/status changes, and audit-event access
- `assistant`: documentation retrieval, Gemini provider, and SSE streaming
- `health`: process liveness and dependency readiness
- Infrastructure modules for configuration, MongoDB, Redis, logging, and HTTP security

Module boundaries are enforced through exported services and narrow interfaces. A module never imports or manipulates another module's Mongoose model directly. External dependencies such as Gemini and Redis sit behind provider interfaces so core behavior can be tested without network calls.

Shared Zod schemas provide runtime validation and inferred TypeScript types for HTTP inputs and safe outputs. The backend remains authoritative. Persistence models and sensitive internal fields are never shared with the frontend.

In development, Vite and NestJS run as separate processes and Vite proxies `/api` to the API. The production Docker build compiles both applications, and NestJS serves the static React build. The browser and API therefore share one origin.

All application endpoints are versioned under `/api/v1`. Health endpoints and Swagger are exposed separately. Swagger availability is controlled by configuration and enabled for the recruiter demo without exposing credentials or secrets.

## 5. Persistence model

### User

- `_id`: MongoDB object identifier
- `email`: trimmed display email as supplied by the user
- `emailKey`: documented case-insensitive comparison key; trim and lowercase only, with no provider-specific dot or plus normalization
- `name`: trimmed display name, 3–80 characters
- `passwordHash`: Argon2id output, excluded from normal queries and every response
- `role`: `USER | SUPPORT | MANAGER | ADMIN`
- `status`: `ACTIVE | DISABLED`
- `version`: optimistic-concurrency version
- `lastLoginAt`: nullable timestamp
- `createdAt` and `updatedAt`: timestamps

MongoDB enforces a unique index on `emailKey`. Duplicate-key errors are translated into a stable `409 EMAIL_ALREADY_REGISTERED` response, including when concurrent signup requests race.

### Session

- `_id`: MongoDB object identifier
- `tokenDigest`: unique SHA-256 digest of a 256-bit random session token
- `userId`: owning user
- `createdAt`, `lastSeenAt`, and `expiresAt`: timestamps
- `revokedAt`: nullable timestamp

The raw session token exists only in the browser cookie and current server request. Session expiry is checked synchronously during authentication. A TTL index performs eventual cleanup only and is never treated as an authorization check.

### Audit event

- `_id`: MongoDB object identifier
- `actorId`: nullable user identifier
- `action`: stable event enum
- `targetId`: nullable target identifier
- `outcome`: `SUCCEEDED | FAILED`
- `requestId`: request correlation identifier
- `metadata`: allowlisted, event-specific non-secret fields
- `createdAt`: timestamp

Audit events are append-only through the application API. Raw passwords, tokens, cookies, CSRF values, connection strings, prompts, and Gemini keys are forbidden from event metadata.

### Security state

A singleton authorization-state record carries a revision number. Every transition that changes ADMIN membership updates this record within the same transaction. This creates a shared write-conflict point so concurrent admin changes cannot both pass a stale last-admin check.

Local development and integration tests run MongoDB as a replica set because administrative mutations use transactions. Production uses MongoDB Atlas with `DB_NAME=easygenerator_auth` or another explicitly new database name.

## 6. Authentication and session design

JWT is intentionally not used. A single-origin modular monolith gains simpler revocation and fewer race conditions from an opaque server-side session.

### Cookie

Production sets one cookie with these properties:

```text
__Host-session=<256-bit random value>; HttpOnly; Secure; SameSite=Strict; Path=/
```

No `Domain` attribute is set. Local HTTP development uses a clearly different cookie name without the `__Host-` prefix or `Secure` flag; production configuration refuses to start if secure cookie requirements are not met.

The cookie contains no user data, role, expiry, or encoded claims. MongoDB stores only its SHA-256 digest.

### Signup

1. Enforce origin, content type, body-size, and distributed rate-limit controls.
2. Validate email, name, and password with the shared input schema.
3. Hash the password with Argon2id starting at `memoryCost=19456 KiB`, `timeCost=2`, and `parallelism=1`; benchmark the deployed instance and only raise this cost when the measured authentication latency remains acceptable.
4. Create an `ACTIVE` user with role `USER`; role and status are not accepted from client input.
5. Catch database duplicate-key races and return the stable conflict code.
6. Create a new session, set the secure cookie, return the safe user and a derived CSRF token, and audit the event.
7. The React app opens the protected application without asking the user to sign in again.

### Signin

1. Apply Redis limits by trusted client IP and an HMAC digest of `emailKey`; Redis keys never contain the raw email.
2. Query the user by `emailKey`; when absent, verify against a process-held dummy Argon2id hash to reduce timing differences.
3. Return the same `401 INVALID_CREDENTIALS` response for an unknown email, incorrect password, or disabled account.
4. On success, create a fresh session, update `lastLoginAt`, set the cookie, return the safe user plus CSRF token, and record a safe audit event.

Default limits are ten signin attempts per trusted IP per 15 minutes and five per email digest per 15 minutes. Signup is limited to five attempts per trusted IP per hour. Responses include `Retry-After` when blocked. Limits remain configurable but cannot be disabled in production.

### Session restoration and CSRF

`GET /api/v1/auth/session` authenticates the cookie, checks session expiry/revocation and the current user status, and returns the safe current user plus a CSRF token. Authenticated responses use `Cache-Control: no-store`.

The CSRF token is an HMAC derived from the raw session token and a separate production secret. React stores it in memory and sends it in `X-CSRF-Token` on authenticated mutations. The server performs constant-time verification. Mutations also require the exact configured production `Origin`, JSON content type where applicable, and compatible Fetch Metadata headers. State-changing behavior never uses `GET`.

### Protected requests and logout

Every protected request loads the non-expired, non-revoked session and current user. Disabled users are denied immediately; current roles are used for authorization rather than cached claims.

`POST /api/v1/auth/logout` requires the CSRF header, revokes the current session, clears the cookie with matching attributes, and succeeds idempotently. Role or status changes revoke all sessions belonging to the target user.

Sessions have a seven-day absolute lifetime so they survive reloads and browser restarts without becoming indefinite. Reauthentication always issues a new session token. Passwords and session material are never stored in `localStorage` or `sessionStorage`.

## 7. Password and request security

The assignment's password contract is authoritative:

- Minimum eight characters
- At least one letter
- At least one number
- At least one special character
- Maximum 128 characters as a defensive processing bound

The UI explains these rules and supports paste, password managers, and a show/hide control. The API accepts Unicode but evaluates the required categories according to the documented shared schema.

Additional HTTP controls include Helmet security headers, a restrictive Content Security Policy, no cross-origin API CORS in production, request-body limits, rejection of unknown input fields, explicit trusted-proxy hops, production HTTPS enforcement, and parameterized data access through Mongoose.

The system is described as a strong production-oriented password-authentication baseline. It does not claim the assurance of MFA, passkeys, verified email, or recovery controls.

## 8. Authorization and administration

Authorization uses named capabilities and explicit actor/target policy functions rather than ordinal role comparisons.

| Capability | USER | SUPPORT | MANAGER | ADMIN |
|---|---:|---:|---:|---:|
| Use protected application and assistant | Yes | Yes | Yes | Yes |
| View user directory | No | Yes | Yes | Yes |
| View redacted audit events | No | Yes | Yes | Yes |
| Change USER or SUPPORT role/status | No | No | Yes | Yes |
| Assign MANAGER or ADMIN | No | No | No | Yes |

Target-level invariants:

- Managers cannot modify themselves, managers, or admins.
- Admins cannot alter their own role or active status.
- The last active admin cannot be demoted or disabled.
- The API rechecks actor, target, version, and last-admin conditions inside the mutation transaction.
- React permission checks only control presentation; the API defaults to deny.
- Stale optimistic-concurrency versions return `409 STALE_USER_VERSION` rather than overwriting another update.

An explicit one-time CLI command bootstraps the first admin from environment variables. It never runs at application startup, refuses to replace an existing account, and refuses to create an additional bootstrap admin after an admin already exists.

The admin dashboard contains only summary counts, server-side search and pagination, a user table, permitted role/status actions, confirmation dialogs, and a redacted audit timeline.

## 9. Documentation-grounded Gemini assistant

The assistant is enabled only when both its feature flag and required Gemini configuration are present. Authentication and readiness never depend on Gemini.

### Corpus and privacy boundary

Only Markdown files committed under `docs/assistant-public/` enter the corpus. The directory contains public-safe explanations of overview, architecture, authentication, authorization, API behavior, and deployment. Arbitrary paths, runtime uploads, source files, repository traversal, user records, environment values, and secrets are impossible inputs to the loader.

This boundary is required because the unpaid Gemini service must not receive confidential, sensitive, or personal information. The UI displays a concise privacy notice and asks users not to submit personal data.

### Retrieval

Documents are split by headings and retain file, heading, and stable chunk identifiers. Retrieval normalizes tokens, removes a fixed English stop-word set, calculates unique query-term coverage per chunk, and boosts exact heading matches.

Up to four chunks are selected. The request is refused locally when the query has no exact heading match and the best chunk covers less than 40 percent of meaningful query terms. A one-term query must exactly match a heading or a documented keyword. This deterministic policy is covered by tests and prevents the model from answering without evidence.

### Generation and streaming

`POST /api/v1/assistant/chat` accepts a message of at most 1,000 characters and at most six prior user/assistant messages totaling no more than 6,000 characters. Only selected documentation excerpts and bounded history are sent to the configured Gemini model. Gemini tools, code execution, URL retrieval, and web access are disabled.

The response uses `text/event-stream` over authenticated `fetch`, not native `EventSource`. Every event contains JSON and uses one of these types:

- `sources`: selected safe file/heading identifiers
- `delta`: incremental answer text
- `done`: completion and non-sensitive usage metadata
- `error`: stable public error code and message

Headers include `Cache-Control: no-store, no-transform`. A client disconnect aborts upstream generation. The server limits each user to one active stream, ten assistant requests per minute, a 30-second provider deadline, and 800 output tokens.

The prompt instructs Gemini to use only supplied excerpts, regard instructions inside questions and documents as untrusted, refuse unsupported claims, and cite source numbers. The frontend sanitizes Markdown, disables raw HTML, rejects unsafe URL schemes, and always shows the server-selected source cards independently of model prose.

Redis caches only versioned retrieval results. Keys contain a hash of normalized query plus corpus version; values contain chunk identifiers, never raw prompts or generated answers. A corpus-content digest invalidates old entries after documentation changes.

## 10. API surface

```text
POST   /api/v1/auth/signup
POST   /api/v1/auth/signin
GET    /api/v1/auth/session
POST   /api/v1/auth/logout

GET    /api/v1/users/me

GET    /api/v1/admin/users
PATCH  /api/v1/admin/users/:id
GET    /api/v1/admin/audit-events

POST   /api/v1/assistant/chat

GET    /health/live
GET    /health/ready
GET    /api/docs
```

`GET /api/v1/users/me` is the required protected endpoint and remains independent of bonus modules.

List endpoints use bounded server-side pagination. User search accepts name/email text, and audit search accepts documented event filters. Responses expose purpose-built safe DTOs rather than persistence documents.

## 11. Error handling, logging, and operations

Errors follow one problem-details shape with `type`, `title`, `status`, stable `code`, `requestId`, and optional field errors. Production never exposes stack traces, raw database errors, provider responses, or account-existence details from signin.

Expected status behavior:

- `400` malformed or invalid request
- `401` missing session or generic invalid credentials
- `403` authenticated but forbidden
- `409` duplicate email, stale version, or protected last-admin conflict
- `429` rate limited, including `Retry-After`
- `503` required dependency unavailable

Operational logs are structured JSON and contain request ID, route template, status, duration, safe actor ID, and safe error code. Logging configuration redacts authorization headers, cookies, passwords, tokens, CSRF values, API keys, connection strings, and request fields known to contain secrets.

`/health/live` checks only that the process can answer. `/health/ready` checks MongoDB and Redis with bounded timeouts; Gemini is excluded. MongoDB failure makes the instance unready. Redis failure is reported as degraded while the instance remains available for authenticated reads; signin, signup, assistant use, and sensitive admin mutations return `503` instead of bypassing distributed limits.

The server handles termination signals, stops accepting new work, aborts active streams, and closes MongoDB and Redis clients. Render's trusted-proxy topology is configured explicitly before forwarded IP or protocol headers are used.

## 12. Frontend experience

The interface uses a refined product aesthetic: warm off-white surfaces, deep ink text, restrained indigo accents, editorial headings, crisp data tables, and subtle motion. It makes no external font, analytics, or tracking requests.

Routes include signup, signin, protected application home, assistant, admin, access denied, and not found. The application shell shows the current identity, role, allowed navigation, and logout.

React Router owns routing, TanStack Query owns server state, React Hook Form uses shared schemas, and a small authentication provider coordinates initial session restoration and in-memory CSRF state. Redux is not introduced.

The signup form provides a live password checklist and automatically opens the application on success. The signin form uses a generic credential message and renders rate-limit recovery. Session restoration has a stable loading state so protected pages do not flash before authentication resolves.

The assistant includes a streaming cursor, cancel button, source cards, grounded refusal state, feature-disabled state, and privacy notice. The admin dashboard includes responsive summary cards, server-paginated search, accessible actions, confirmation dialogs, stale-update recovery, and audit events.

All critical interactions are keyboard complete, have visible focus, accessible labels and error announcements, managed dialog focus, WCAG AA contrast, responsive layouts, and reduced-motion behavior.

## 13. Testing strategy

Tests prioritize security invariants and user behavior.

Backend unit and integration coverage includes:

- Shared validation and safe DTO mapping
- Argon2id hashing and generic signin behavior
- Concurrent duplicate signup
- Cookie flags, CSRF validation, exact-origin rejection, expiry, logout, and disabled-user denial
- Rate-limit keys and blocked responses without raw identity leakage
- Complete role/capability/target matrix
- Stale updates, self-modification rules, concurrent last-admin protection, atomic audit creation, and session revocation
- Assistant retrieval acceptance/refusal, prompt construction, provider timeout, SSE framing, disconnect cancellation, and safe errors
- Redis outage behavior for reads and sensitive actions
- Log and audit redaction

Frontend tests include signup/signin validation, password checklist behavior, session restoration, protected and permission-aware routing, API error mapping, fragmented SSE parsing, cancellation, sanitized rendering, and accessible form/dialog behavior.

Playwright covers the main recruiter journey: signup, automatic signin, protected welcome page, logout, signin, and an authorized admin action with a forbidden counterpart.

Integration tests use real MongoDB replica-set and Redis services. Gemini is always replaced by a deterministic fake in automated tests, so CI does not need an API key or consume quota.

## 14. CI/CD and deployment

GitHub Actions runs on pull requests and pushes to `main`:

1. Frozen dependency installation
2. Formatting and lint checks
3. TypeScript checks
4. Backend and frontend unit tests
5. MongoDB/Redis integration tests
6. Production web/API build
7. Multi-stage Docker image build
8. Playwright smoke journey

Render is linked to the GitHub repository and configured to deploy `main` only after CI checks pass. The production container runs as a non-root user, includes only runtime artifacts/dependencies, respects Render's assigned port, and serves both the API and React application.

Docker Compose runs the application, MongoDB replica set, and Redis locally. Production uses the approved MongoDB Atlas connection with a new database name and a managed Redis instance. Secrets exist only in local ignored environment files, GitHub/Render secret stores where required, and `.env.example` contains names and safe descriptions only.

After deployment, a smoke check verifies liveness, readiness, the frontend shell, and a protected-route denial. The final README includes the live Render URL.

## 15. Documentation and AI disclosure

The repository includes:

- `README.md`: purpose, architecture summary, prerequisites, five-minute setup, commands, environment variables, tests, API docs, Docker, deployment, and demo usage
- `AI.md`: which areas were AI-assisted, effective prompting approaches, verification performed, rejected suggestions, corrections, and developer-owned decisions
- Public assistant documents describing actual implemented behavior
- Architecture/security notes explaining the modular-monolith and opaque-session decisions
- `.env.example`, OpenAPI/Swagger, and deployment configuration

`AI.md` explicitly records that an independent high-reasoning review identified cross-tab refresh-token races, native `EventSource` limitations, and free-Gemini privacy constraints, resulting in the opaque session and public-document allowlist design.

## 16. Key design rationale

- A modular monolith is the smallest architecture that provides clear domain boundaries without one-day microservice overhead.
- One same-origin production service makes strict cookie security and deployment materially simpler.
- Opaque server-side sessions provide immediate authorization changes and logout without JWT refresh-family races.
- MongoDB remains authoritative for identity, session, and authorization state; Redis loss cannot silently grant access.
- Explicit actor/target authorization prevents privilege escalation that a simple role hierarchy would miss.
- Deterministic document retrieval and a strict allowlist are more testable and private than broad source ingestion or unnecessary vector infrastructure.
- The assistant is feature-flagged and scheduled last so optional AI cannot compromise the required assessment.

## 17. Reference guidance

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)
- [Render deployment documentation](https://render.com/docs/deploys)
