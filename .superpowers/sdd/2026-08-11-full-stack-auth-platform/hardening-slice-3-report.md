# Hardening Slice 3 Evidence Report

## Scope and baseline

- Baseline: `60eee28bf6ddaad871851ee8307740257008301c`
- Scope: query-safe API telemetry and Problem Details instances only
- Production files: `request-path.ts`, `logging.module.ts`, and
  `problem-details.filter.ts`
- Regression files: the corresponding HTTP, logging, and problem-filter specs
- Redaction remains configured unchanged as defense in depth.

## TDD evidence

The initial Node 24 focused run failed before production changes:

```text
v24.18.0
Test Files  3 failed (3)
Tests       3 failed | 30 passed (33)
```

The failures demonstrated all three missing behaviors: no `requestPath`
module, a query-bearing Problem Details `instance`, and Pino output retaining
URL, query, headers, and socket metadata.

After the minimal implementation, the same focused command passed:

```text
v24.18.0
Test Files  3 passed (3)
Tests       40 passed (40)
```

Command:

```sh
pnpm --filter @easygenerator/api test -- src/platform/http/request-path.spec.ts src/platform/logging/logging.module.spec.ts src/platform/errors/problem-details.filter.spec.ts
```

A narrow mutation temporarily restored `url: request.url` to the request
serializer. The Node 24 logging spec then failed both the direct exact-allowlist
assertion and actual wrapped-output assertion (`2 failed | 2 passed`), exposing
the raw query-bearing URL in each diff. The mutation was removed before final
verification.

## Security assertions

- `requestPath` slices at the first `?` or `#` without URL parsing or decoding
  and returns `undefined` for missing, empty, query-only, and fragment-only
  inputs.
- The request serializer constructs exactly `{ id, method, path }`; it does
  not spread or return raw URL, headers, query, body, cookies, authorization,
  CSRF, socket address, or socket port fields.
- Direct Express-like and actual default-wrapped `pino-http` request shapes
  are covered. The emitted request object contains the safe server request ID,
  method, and pathname only; an attacker-controlled `x-request-id` and all
  metadata sentinels are absent.
- The problem filter computes the sanitized pathname once and reuses that
  exact value for both `instance` and protected-route cache classification.
- The admin regression proves the exact pathname instance, absent email/token
  query sentinels, and preserved `Cache-Control: no-store`.
- Existing Task 11 problem mapping/OpenAPI behavior remains exercised by the
  full API unit suite; no OpenAPI code changed.

## Fresh verification

All commands ran with Node `v24.18.0`.

```text
pnpm --filter @easygenerator/api test
Test Files  42 passed (42)
Tests       414 passed (414)

pnpm --filter @easygenerator/api lint
exit 0

pnpm --filter @easygenerator/api typecheck
exit 0

pnpm --filter @easygenerator/api build
exit 0

pnpm --filter @easygenerator/api test -- src/main.spec.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

Final formatting and diff checks are run after this report is added and are
recorded in the commit handoff.

## Self-review

- Every production line changed maps to the Slice 3 contract.
- Mutation check: restoring the raw problem target, default Pino request
  serialization, header-derived IDs, or query/fragment retention breaks the
  focused regressions.
- Independent review reported no Critical or Important findings.
- No web, database startup, Redis, admin limiter, packaging, deployment, or
  unrelated documentation paths were changed.
- Concerns: none identified within Slice 3 scope.
