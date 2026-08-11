# Hardening Slice 4 Report

## Result

Implemented Slice 4 from base `8e5811bea377b347c20a86f826b3447538192ee0`.
Administrative PATCH operations now fail closed behind private actor and trusted-IP
Redis counters, while both administrative GET operations remain Redis-free.
Existing auth and assistant identity-bearing Redis keys now use scoped HMAC
digests, and assistant lease release retains opaque compare-and-delete ownership.

`AdminService`, Mongo authorization/session authority, database startup,
telemetry production code, web code, contracts, packaging, deployment, and Atlas
were not changed.

## Implementation

- Generalized `RateLimiterService` to the environment-isolated
  `easygenerator:<validated NODE_ENV>:rate-limit:` namespace. It rejects
  non-positive/non-integer limits or windows before Redis access and rejects all
  malformed Lua count/TTL results.
- Moved `RateLimitExceededError` into the Redis platform and exported the
  generic limiter through `RedisModule`.
- Added `PrivacyKeyDigestService`, using HMAC-SHA-256 Base64URL with
  `scope + NUL + value` domain separation.
- Auth signup/signin IP keys and signin identity keys use the exact stable digest
  scopes from the brief. Digest calculation is inside the auth protection
  boundary; failed-signin audit data reuses the same scoped identity digest.
- Assistant rate and lease actor keys use their exact stable digest scopes.
  Digest failure maps to `ASSISTANT_PROTECTION_UNAVAILABLE` without Redis access.
  Lease release still uses Redis compare-delete against the opaque owner token.
- Added `AdminMutationProtectionGuard` only to PATCH after
  `SessionGuard`, `CsrfGuard`, and `CapabilityGuard`. It consumes actor and IP
  counters concurrently at 20 requests per 60 seconds, returns the greatest
  blocked TTL through `RATE_LIMITED`, maps protection failures to
  `ADMIN_MUTATION_PROTECTION_UNAVAILABLE`, and preserves `UNAUTHENTICATED` when
  no principal exists.
- Documented 429 and 503 only on the admin PATCH OpenAPI operation.

## TDD and mutation evidence

The sub-slices were implemented RED to GREEN on Node 24.18.0:

- Generic limiter/privacy RED: 20 expected limiter failures plus the missing
  privacy-service module; GREEN: 32/32.
- Auth RED exposed raw IP keys, identity hashing outside the protection
  boundary, and missing digest-failure mapping; GREEN with the problem filter:
  45/45.
- Assistant RED exposed raw actor rate/lease keys and missing digest-failure
  mapping; GREEN across limiter, concurrency, service, and namespace tests:
  68/68.
- Admin guard RED began with the missing guard module; GREEN: 6/6, including
  exact PATCH guard order/scope.

Behavior-sensitive mutations were applied temporarily, observed failing, and
restored before final verification:

- Removing NUL HMAC domain separation failed 2 privacy digest tests.
- Changing greatest blocked TTL from `Math.max` to `Math.min` failed the admin
  retry aggregation test (47 expected, 13 received).
- Reordering admin mutation protection before capability failed the exact guard
  metadata test.
- Changing assistant lease ownership comparison from `==` to `~=` failed 5
  Docker integration tests, including the stale-release proof where the newer
  owner's lease was deleted. The final source uses `==`.

## Real Docker proofs

The final disposable Docker integration run passed 5 files / 54 tests and
removed its MongoDB/Redis containers, volumes, and network. Coverage includes:

- cursor-exhausting SCAN checks for private auth, assistant rate, assistant
  lease, and admin mutation keys;
- exact trusted-proxy handling with restoration;
- first 20 authorized stale admin PATCHes reaching `409 STALE_USER_VERSION` and
  the 21st returning `429 RATE_LIMITED`, positive `Retry-After`, and `no-store`;
- a separate application Redis client reaching `end`, after which both admin
  GET endpoints remain 200/no-store while PATCH returns the feature-specific
  503/no-store;
- unchanged target status/version and audit count after protected failures;
- assistant compare-delete ownership safety; and
- PATCH-only 429/503 OpenAPI response maps.

## Final verification

All final gates used Node 24.18.0:

- Workspace format check: passed.
- Workspace lint: passed.
- Workspace typecheck: passed.
- Workspace build: passed.
- Contracts tests: 100 passed.
- API tests: 454 passed.
- Web tests: 168 passed.
- Docker integration: 5 files / 54 tests passed; teardown completed.

## Rollout constraint

The first HMAC-key deployment must use a new empty Redis database. A later
upgrade from a pre-HMAC release must either use another new empty database or a
non-overlapping cutover that blocks sensitive traffic for 60 minutes after the
last old auth counter write and at least 35 seconds after the last old assistant
admission. There are no raw-key fallbacks or dual writes; old ephemeral keys
expire naturally.

No remaining implementation concern is known beyond honoring this rollout
constraint.
