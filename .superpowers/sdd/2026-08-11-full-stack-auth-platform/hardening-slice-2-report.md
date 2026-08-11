# Cross-cut hardening Slice 2 report — authenticated 401 expiry

## Status

Slice 2 is implemented from the required Slice 1 base
`09bb48bf02aa1fa8c002ff417179fb41b46fc3b1`. An authenticated browser 401
now synchronously publishes one application-wide expiry signal before the
parsed `ApiProblem` is thrown. `AuthProvider` consumes that signal to revoke
in-memory authority, invalidate restoration generations and the module-level
restoration singleton, abort assistant streams, cancel and clear query data,
and allow `ProtectedRoute` to replace a protected URL with `/signin`.

Public session restoration, signup, and signin explicitly use the
`form-or-restoration` policy. A normal `INVALID_CREDENTIALS` response remains
local form feedback and does not clear unrelated cache data.

## Delivered behavior

- Added a dependency-free synchronous auth-expiry publisher/subscriber. It
  snapshots listeners before iteration, returns a `void` unsubscribe closure,
  and isolates subscriber exceptions so later delivery and the parsed problem
  are preserved.
- Added `authenticationFailure` to the API client's internal options with
  `expire-session` as the default. A default 401 publishes after problem
  parsing and before throwing the same `ApiProblem`; the option is destructured
  before constructing native `fetch` options.
- Made `authApi.session`, `authApi.signUp`, and `authApi.signIn` explicitly use
  `form-or-restoration` rather than inferring policy from URLs.
- Made the assistant pre-stream failure path publish the same event after its
  specialized problem parser returns and before throwing a 401 problem.
- Added one provider expiry callback that increments the restoration
  generation, clears the module-level cached restoration promise, aborts
  assistant streams, clears session-derived user/CSRF/features and auth errors,
  sets anonymous status, calls `cancelQueries()`, and immediately calls
  `queryClient.clear()`.
- Routed provider-owned restoration 401s and completed/expected-401 logout
  behavior through the same revocation path. Protected routes continue to use
  the existing anonymous redirect branch.
- Kept identity, CSRF, features, and query data in memory; no browser-storage
  access was added.

## RED to GREEN evidence

All commands below ran with Node.js `v24.18.0`.

### Dependency-free expiry event

The first focused RED failed because `auth-expiry.ts` did not exist:

```text
pnpm --filter @easygenerator/web exec vitest run src/features/auth/auth-expiry.spec.ts
FAIL: Failed to resolve import "./auth-expiry"
```

The minimal Set-backed snapshot publisher made the subscribe/unsubscribe,
self-removal, and throwing-listener cases GREEN:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

Every sentinel listener is unsubscribed in `finally`, preventing module-global
test leakage.

### API client policy and auth call sites

The API-client RED isolated both missing behaviors:

```text
Test Files  1 failed (1)
Tests       2 failed | 8 passed (10)
- protected 401 order lacked "expiry"
- native fetch options retained authenticationFailure
```

After adding the default policy, synchronous publisher, and internal-option
destructuring, the API-client and event tests passed (2 files / 13 tests).

The new real-fetch `auth-api.test.ts` then failed all three cases because
session restoration, signup, and signin still published expiry:

```text
Test Files  1 failed (1)
Tests       3 failed (3)
expected expiry listener not to be called; received one call per case
```

Adding the explicit call-site policy made the combined event/client/auth API
gate pass (3 files / 16 tests). Each case also proves the parsed 401 remains
available to its caller and the internal option never reaches `fetch`.

### Assistant pre-stream 401

The assistant RED parsed the exact problem but observed no preceding expiry:

```text
Test Files  1 failed (1)
Tests       1 failed | 21 passed (22)
expected ["expiry", ApiProblem], received [ApiProblem]
```

Publishing only after `parseProblem()` and before throwing made all 22
assistant API tests pass while preserving cancellation, Retry-After, media
type, and protocol-error coverage.

### Provider authority, cache, and restoration races

The first provider RED established the security symptom at `/admin`:

```text
Test Files  1 failed (1)
Tests       1 failed | 8 passed (9)
Unable to find the /signin heading; status remained authenticated and the
private-admin-sentinel remained rendered.
```

The shared callback and subscription made the race test GREEN. It proves an
ADMIN session established while an older restoration is pending loses user,
CSRF, features, protected DOM, cached admin data, and an active assistant
stream when an in-flight admin query returns `401 UNAUTHENTICATED`. Retrying
restoration before the older request settles creates request 2 rather than
reusing the invalidated singleton; resolving the older ADMIN response cannot
restore authority.

Mutation review then separated three additional RED failures:

```text
Test Files  1 failed (1)
Tests       3 failed | 9 passed (12)
- provider-owned restoration 401 retained private-restoration-data
- restoration error survived publication
- logout error survived publication
```

Routing restoration 401 through the callback and clearing both error states
made all 12 provider tests pass. The complementary real-form test proves a
public `401 INVALID_CREDENTIALS` keeps the signin form mounted, publishes no
expiry event, and retains an unrelated query-cache sentinel.

A narrow mutation proof removed only `restoration = undefined` from the expiry
callback and reran the restoration-race test. It failed at the intended
contract because retry reused the older singleton (`expected sessionRequests
2, received 1`). Restoring the line made the same test pass (1 selected / 11
skipped), proving the race assertion is sensitive to cached-restoration
invalidation rather than merely to anonymous rendering.

## Final verification

Fresh final commands and observed results:

- `node --version`: `v24.18.0`.
- `pnpm --filter @easygenerator/web exec vitest run src/features/auth/auth-expiry.spec.ts src/lib/api-client.test.ts src/features/auth/auth-api.test.ts src/features/assistant/assistant-api.test.ts src/features/auth/AuthProvider.test.tsx`:
  5 files / 50 tests passed.
- `pnpm --filter @easygenerator/web test`: 18 files / 168 tests passed.
- `pnpm --filter @easygenerator/web lint`: passed with no findings.
- `pnpm --filter @easygenerator/web typecheck`: passed.
- `pnpm --filter @easygenerator/web build`: passed; Vite emitted its existing
  non-fatal chunk-size advisory.
- `pnpm format:check`: all repository files matched Prettier style.
- `git diff --check`: passed.

## Scope and self-review

The implementation changes only the ten locked Slice 2 web paths plus this
required report:

- `apps/web/src/features/auth/auth-expiry.ts`
- `apps/web/src/features/auth/auth-expiry.spec.ts`
- `apps/web/src/features/auth/auth-api.test.ts`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/lib/api-client.test.ts`
- `apps/web/src/features/auth/auth-api.ts`
- `apps/web/src/features/auth/AuthProvider.tsx`
- `apps/web/src/features/auth/AuthProvider.test.tsx`
- `apps/web/src/features/assistant/assistant-api.ts`
- `apps/web/src/features/assistant/assistant-api.test.ts`

Self-review confirmed synchronous publication order, snapshot and
failure-isolated fan-out, explicit public-call policies, native-fetch option
privacy, immediate query removal after cancellation starts, module-singleton
clearing, restoration-generation checks, protected-route replacement, and the
public-invalid-credentials boundary. API server, telemetry, Redis/admin
limiter, packaging, product-documentation, and deployment files are unchanged.

## Commit

Commit message: `fix: clear client authority on authenticated 401`.
