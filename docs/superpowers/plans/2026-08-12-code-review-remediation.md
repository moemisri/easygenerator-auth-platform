# Four-Domain Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:systematic-debugging`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. Parallel workers have non-overlapping ownership; do not edit outside the assigned files.

**Goal:** Resolve every actionable defect in the 12 August four-domain review while preserving the platform's security invariants and producing reproducible CI, backend, frontend, and deployment behavior.

**Architecture:** Work is divided into delivery/quality, core backend/auth, assistant backend, and frontend streams. Each stream writes a failing behavioral test before production changes, verifies its focused suite, and leaves cross-domain integration to the primary agent. Recommendations that conflict with an explicit product contract must be documented with the conflicting contract and a technically justified disposition rather than implemented blindly.

**Tech Stack:** pnpm 11.0.6, Node 24.18.0, TypeScript 5.9, NestJS 11, React 19, TanStack Query 5, Vitest 4, Playwright 1.62, MongoDB 8, Redis 8, Docker, GitHub Actions, Render.

## Global Constraints

- Worktree: `/Users/moemisri/Projects/easygenerator/.worktrees/review-remediation` on `codex/review-remediation` from `6bcc3c69dfb44570eccdbac131a901ee25bc948c`.
- Review source: `/private/tmp/claude-501/-Users-moemisri-Projects-easygenerator/51b548cd-92f5-4506-91ac-f4a95c6092c2/scratchpad/review.html`.
- Preserve same-origin cookie authentication, exact-origin CSRF protection, fail-closed Redis protection, transactionally serialized admin mutations, privacy-preserving Redis keys, safe RFC 7807 errors, and redacted logs.
- Use Node `24.18.0` for all evidence; no test may depend on Node 25 behavior.
- Never expose raw email, IP, cookie, session token, CSRF token, provider prompt, provider response, Redis URL, MongoDB URI, or secret in logs, errors, artifacts, or cache keys.
- Do not edit the historical design spec or the earlier implementation plan. Update active docs only when behavior changes.
- Do not touch `/Users/moemisri/Projects/easygenerator/.worktrees/full-stack-auth-handoff` or the original checkout's untracked `.pnpm-store/`.
- Parallel workers do not commit. The primary agent owns integration, review, full verification, and commits.

---

### Task 1: Delivery, CI, quality gates, and deployment artifacts

**Files:**

- Modify: `.github/workflows/ci.yml`, `playwright.config.ts`, `render.yaml`, `Dockerfile`, `compose.yaml`, `.env.example`, `.npmrc`
- Modify: `package.json`, `pnpm-lock.yaml`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, Vitest configs, `eslint.config.mjs`
- Modify: `scripts/run-e2e.mjs`, CI summary/coverage scripts, delivery/secret/render/image platform specs
- Delete only if behavioral verification supersedes it: `apps/api/src/platform/production-package.spec.mjs`

**Interfaces:**

- Produces a browser CI job that builds before e2e, preserves diagnostics on failure, and executes against production-built assets.
- Produces enforceable source coverage, type-aware TypeScript linting, React Hooks linting, and focused-test protection.
- Produces a Render blueprint that boots without an unset optional Gemini key, disables production Swagger, and checks readiness.
- Produces a container/app health check compatible with `docker compose up --wait`.

- [ ] Write behavioral platform tests that fail when the browser job lacks a build, failure artifacts are not uploaded, secret scans are absent, supported environment keys are undocumented, and the application container lacks health readiness.
- [ ] Run focused platform tests and confirm failures name the missing behavior rather than literal step-list drift.
- [ ] Implement CI build-before-e2e, tracked/reachable secret scans, independent best-effort summaries, Playwright failure artifacts, one CI retry, and use the API test wrapper where it is the supported entry point.
- [ ] Replace raw-process V8 decoration with source coverage and thresholds supported by Vitest; choose thresholds no lower than the measured baseline and record the measured values in the worker report.
- [ ] Enable type-aware TypeScript, React Hooks, and Vitest lint rules; resolve only violations exposed by the new rules and do not weaken rules globally to hide findings.
- [ ] Make contracts development/typechecking resolve current source rather than stale `dist`, while production/default exports continue to use built artifacts; exclude contract tests from emitted production files.
- [ ] Make Render default to an assistant-disabled boot until Gemini settings are explicitly configured, disable Swagger in production, and use `/health/ready`.
- [ ] Add application health checks to the image and Compose service; add conservative Compose resource limits without changing Mongo/Redis durability semantics.
- [ ] Enforce the exact Node engine through repository package-manager configuration.
- [ ] Remove source-text change detectors only where an executable behavior/image check covers the same invariant; retain negative secret-pattern checks.
- [ ] Run focused platform tests, lint, typecheck, build, and render validation; write exact commands and results to the task report.

### Task 2: Core backend, authentication, sessions, administration, and observability

**Files:**

- Modify: `apps/api/src/main.ts` and its tests; `scripts/verify-production-image.mjs` only for the explicit bootstrap switch
- Modify: `apps/api/src/platform/config/**`, `errors/problem-details.filter*`, `http/request-id.middleware*`, `redis/rate-limiter.service*`, `redis/redis.module.ts`
- Modify: `apps/api/src/modules/auth/**`, `health/**`, `admin/**`, `users/**`, `audit/**` and their unit/integration tests
- Do not edit: `apps/api/src/modules/assistant/**`, root manifests, CI, Render, Docker, or frontend files

**Interfaces:**

- Consumes `SESSION_TTL_SECONDS` and `COOKIE_SECURE` from validated configuration.
- Produces readiness status 503 when either mandatory protection dependency is unavailable.
- Produces safe post-header exception behavior, validated inbound request-ID propagation, failure-only sign-in throttling, and emitted rejected-session audit events.

- [ ] Add failing tests proving cookie flags/name and cookie/session expiry use the validated configuration, and development/test fallback secrets are process-random rather than public constants.
- [ ] Implement the minimal configuration wiring and random process defaults; retain production-required secrets and canonical base64 validation.
- [ ] Add failing tests for Redis-down readiness 503 and implement dependency-complete readiness.
- [ ] Add failing tests for an exception after headers are sent; end the response without status/json rewriting while retaining safe logging.
- [ ] Replace the Vitest-coupled production bootstrap switch with explicit `APP_BOOTSTRAP=false`, and make startup failures terminate nonzero with a sanitized diagnostic.
- [ ] Accept only a syntactically valid UUID `X-Request-Id`; generate a UUID for missing/malformed values so arbitrary attacker text cannot enter logs.
- [ ] Add a non-consuming rate-limit inspection operation, block already-exhausted sign-in buckets before password work, consume IP/identity buckets only after failed authentication, and ensure successful authentication does not mutate either bucket.
- [ ] Emit `SESSION_REJECTED` with an allowlisted reason and actor ID when known; an audit write failure must not turn the required 401 into a 500 and must be safely logged.
- [ ] Preserve the explicit self-edit prohibition. Remove or redesign unreachable last-admin code/tests without weakening the cross-admin serialization that prevents two concurrent removals.
- [ ] Cap admin page numbers in the shared contract, add indexes matching supported admin sorts, avoid timestamp rewrites for already-revoked sessions, and replace only the unconditional user count with an estimated count.
- [ ] Keep only audit indexes used by readers and add a documented bounded-retention TTL index.
- [ ] Gracefully `QUIT` Redis on shutdown instead of dropping in-flight commands.
- [ ] Evaluate signup enumeration against the explicit automatic-signin contract; do not pretend a renamed error fixes status-based enumeration. Record either a complete compatible mitigation or a justified residual-risk disposition.
- [ ] Run all modified unit tests plus auth/admin integration tests and report exact results.

### Task 3: Assistant streaming, cost controls, lifecycle, and retrieval

**Files:**

- Modify only: `apps/api/src/modules/assistant/**` and `apps/api/test/integration/assistant.integration.spec.ts`
- Do not edit: core auth/health/config/platform files, root manifests, deployment files, or frontend files

**Interfaces:**

- `AssistantStreamContext` includes the trusted request IP in addition to request ID and user ID.
- The assistant rate limiter enforces per-user, per-IP, and global fixed-window budgets with privacy-safe keys.
- Streaming write failures are contained after headers flush; leases cannot expire during active provider work and do not impose a misleading 35-second post-timeout lockout.

- [ ] Add failing tests for `response.write()` throwing after headers flush, and make `writeEvent` return false without throwing or writing a terminal event twice.
- [ ] Add failing tests for global/IP/user assistant budgets and implement atomic fail-closed enforcement using domain-separated HMAC keys for user/IP and a non-sensitive global key.
- [ ] Add failing tests proving a slow corpus/cache/retrieval preamble cannot consume the provider lease lifetime; acquire the provider concurrency lease only immediately before provider streaming or implement token-safe renewal.
- [ ] Preserve one-provider-stream-per-user. After timeout/disconnect, abort the provider and avoid a user-visible 35-second false-retry window; document the exact concurrency safety argument in the task report.
- [ ] Make refusal auditing best-effort with safe stable-code logging so an audit outage cannot replace a 429/refusal outcome.
- [ ] Memoize the immutable allowlisted corpus after the first successful load; failed loads remain retryable.
- [ ] Fit ranked excerpts within the 12,000-character budget by dropping lowest-ranked chunks and safely truncating a single oversized top chunk; remove duplicated orchestration checks.
- [ ] Reuse one lazily constructed Gemini client and retry only transient failures before the first streamed chunk, with abort-aware bounded backoff; never retry after output begins.
- [ ] Add safe operation-level logs where a normalized 503 currently erases the failing dependency, without including provider/corpus/cache input.
- [ ] Run every assistant unit test plus assistant integration tests and report exact results.

### Task 4: Frontend identity boundaries, routing, streaming performance, and accessibility

**Files:**

- Modify: `apps/web/src/app/**`, `apps/web/src/main.tsx`, `apps/web/src/components/ProblemAlert*`, `apps/web/src/features/auth/**`
- Modify: `apps/web/src/features/assistant/**`, `apps/web/src/features/admin/**`, `apps/web/src/styles/**`, `apps/web/src/test/server.ts`, relevant web tests
- Do not edit: backend, manifests, lockfile, CI, Render, Docker, or Playwright configuration

**Interfaces:**

- Successful identity changes cancel and clear all query data before the new session becomes observable.
- Protected redirects preserve an internal destination; auth pages redirect already-authenticated users; unsafe/external destinations fall back to `/app`.
- Problem alerts focus only when explicitly requested by form submission callers.
- Assistant deltas are coalesced before React state commits; completed historical turns do not reparse on every delta.

- [ ] Add failing tests for identity-change cache clearing and authenticated auth-route guards; implement both without clearing cache on failed sign-in.
- [ ] Add failing deep-link tests and preserve internal destinations through sign-in and sign-up; reject protocol-relative/external destinations.
- [ ] Add failing focus/countdown tests; make `ProblemAlert` opt-in autofocus, resynchronize changed `retryAfter`, and use one drift-resistant deadline timer.
- [ ] Add render-count/coalescing tests; memoize stable assistant turns/Markdown and flush accumulated deltas at animation-frame cadence with final synchronous flush.
- [ ] Lift duplicated user-row control state so desktop/mobile representations stay synchronized, and avoid mounting duplicate dialog state where practical.
- [ ] Keep admin live regions permanently mounted and update only their text.
- [ ] Add a tested application error boundary and lazy route chunks with accessible loading fallback.
- [ ] Add transcript scrolling/follow behavior that keeps the composer and Stop control available; move focus to a completed answer only when the user initiated that request and doing so does not steal active composer input.
- [ ] Preserve the `disabled` terminal state for logout aborts.
- [ ] Make the horizontally scrollable user table keyboard-focusable and labelled.
- [ ] Configure deliberate admin query freshness/window-focus behavior and remove the ineffective fresh-object callback dependency.
- [ ] Validate MSW response fixtures with shared contracts at the mock boundary.
- [ ] Run all web tests, accessibility checks, typecheck, lint, and the production web build; report exact results.

### Task 5: Integration review and final verification

**Files:**

- Modify only integration seams or active documentation required by merged behavior.

- [ ] Review each worker diff against the review report and this plan; reject out-of-scope or speculative changes.
- [ ] Resolve cross-stream type/lint/test conflicts without weakening security or deleting behavioral coverage.
- [ ] Run formatting, lint, typecheck, all unit tests, all integration tests with real Mongo/Redis, production builds, e2e, Render validation, secret scans, and Docker image verification.
- [ ] Re-read every report finding and record fixed, rejected-with-rationale, or residual-risk status.
- [ ] Request a final independent code review, fix all load-bearing findings, and re-run the affected verification before completion.
