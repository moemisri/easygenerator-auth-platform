# AI Assistance Record

AI was used as a force multiplier for planning, scaffolding suggestions,
validation/security test design, documentation drafting, and independent review.
The developer retained responsibility for requirements, threat boundaries,
implementation choices, verification, and every accepted diff.

## Effective approach

The strongest review prompt was: inspect the scoped commit range against the
written plan; challenge browser behavior, authentication/authorization,
privacy, operational failure modes, and tests; report only reproducible
Critical or Important findings with a concrete path to verify each fix.

The workflow used tests before behavioral changes, focused red/green cycles,
mutation checks for security-sensitive paths, then exact Node 24, browser, and
real Docker integration gates. Multiple read-only reviewers inspected admin,
Redis/privacy, packaging, and delivery surfaces while a single writer prevented
conflicting edits.

## Developer-owned corrections

- Replaced an early access/refresh-JWT direction with opaque, server-side,
  revocable sessions and CSRF protection. Verified by API unit/integration and
  browser authentication suites.
- Replaced native `EventSource` with authenticated POST `fetch` SSE so bounded
  history and CSRF headers cross the correct boundary. Verified by assistant API,
  lifecycle mutation, and Chromium tests.
- Replaced arbitrary context with a strict allowlist of six public Markdown
  documents, deterministic retrieval, server-selected citations, and refusal.
  Verified by loader/retriever/provider and integration tests.
- Corrected session restoration races so stale async restoration cannot overwrite
  newer auth or recover after global expiry. Verified by focused mutation tests.
- Corrected admin singleton concurrency proof, fail-closed role/status handling,
  Redis privacy keys, and rate-limit outage behavior. Verified with real MongoDB
  and Redis integration tests.
- Corrected stalled async-generator cleanup, SSE timeout/release ordering, and
  signal-safe Docker cleanup. Verified by failure-sensitive unit and Docker
  tests.
- Corrected production ESM output from extensionless imports to NodeNext-safe
  `.js` specifiers and named ioredis imports. Verified by importing compiled
  `dist/main.js` and the compiled admin CLI under plain Node `24.18.0`.
- Corrected production static test lifecycle so the real Nest HTTP adapter is
  present when static providers initialize. Verified by the production static
  HTTP integration suite.
- Corrected secret scanning to inspect tracked worktree bytes, recognize exported
  bootstrap assignments and canonical base64 values, avoid integrity/path false
  positives narrowly, and scan reachable blobs without echoing values. Verified
  by focused tests plus both committed scanner commands.

## What required rework

Generated or suggested code was not accepted on appearance. Review found and
reworked false-positive tests, missing field boundaries, Node-version drift,
query-bearing telemetry, incomplete Redis outage handling, a deliberate
compare-delete mutation, unsafe cleanup signal forwarding, the compiled ESM
runtime failure, Docker layout omissions, and scanner false negatives/positives.
Each correction was rerun with the narrow command that reproduced the issue,
then included in the full gate.

## Correction evidence

| Correction                                              | Verification command                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Plain Node ESM and compiled admin CLI                   | `pnpm --filter @easygenerator/api test -- compiled-runtime.spec.mjs`                           |
| Production SPA fallback and API/health/asset exclusions | `pnpm --filter @easygenerator/api test -- production-static.spec.ts`                           |
| Smoke origin/status/content/secret safety               | `pnpm --filter @easygenerator/api test -- post-deploy-smoke.spec.mjs`                          |
| Tracked and reachable secret scanning                   | `node scripts/scan-secrets.mjs --tracked` and `node scripts/scan-secrets.mjs --reachable HEAD` |
| CI, Blueprint, env, and documentation policy            | `pnpm --filter @easygenerator/api test -- delivery-artifacts.spec.mjs`                         |
| Non-root production image, offline bootstrap, and tini  | `node scripts/verify-production-image.mjs easygenerator-auth:task12`                           |
| Redis privacy and admin fail-closed behavior            | `pnpm --filter @easygenerator/api test:integration`                                            |
| Browser authentication/admin journeys and cleanup       | `pnpm e2e`                                                                                     |

Same-origin Compose smoke remains pending because the operator-owned ignored
`.env.local` does not exist; the task deliberately does not create or populate
secret files. Production image inspection is complete for local image digest
`sha256:401e5b2c85369f601b1c75934ff036c4962f898729130495168d1309b9758c26`.

## Known limitations

There is no MFA, email verification, password reset, distributed tracing, or
provider failover. Assistant retrieval is lexical rather than semantic. Cloud
account creation, Atlas access, Render secrets, public URLs, admin credentials,
and live release evidence are intentionally absent until the account holder
approves and executes those gates. The tested/deployed commit SHA and URL will
be recorded only after that deployment exists.
