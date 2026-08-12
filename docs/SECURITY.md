# Security model

## Assets and trust boundaries

Protected assets are password hashes, opaque sessions and CSRF material, user
roles/status, audit records, database/cache credentials, and Gemini provider
configuration. The browser is untrusted; Nest owns validation and authorization.
MongoDB is authoritative for users, sessions, audits, and security revision.
Redis is a protective/cache dependency, not an identity source. Gemini receives
only bounded user-provided chat context plus excerpts from the public corpus.

## Authentication and sessions

Passwords are length-bounded and Argon2-hashed. Signin uses generic failures and
privacy-preserving throttling. Session identifiers are opaque, hashed at rest,
HttpOnly, `SameSite=Strict`, host-only secure cookies in production. Expired,
revoked, malformed, disabled-user, and unknown-state sessions fail closed.
Logout revokes server state.

Authenticated mutations require a session-bound CSRF token, exact same-origin
evidence, and compatible Fetch Metadata. The proxy trust count is explicit.

## Authorization and administration

Capabilities are server-derived from `USER`, `SUPPORT`, `MANAGER`, or `ADMIN`.
Unknown roles/capabilities fail closed. Transactions and a serialized security
revision protect concurrent role/status mutations; users cannot mutate
themselves and the last active administrator cannot be removed. Admin mutations
are actor/IP limited before service execution and fail closed if their protection
service is unavailable.

## Redis and assistant privacy

Redis keys are environment-namespaced HMAC digests, not raw IP addresses or user
IDs. Sensitive auth, assistant admission, and admin writes deny on digest/Redis
failure. Releases use opaque lease token compare-delete. First production rollout
must use a new empty Redis service; later raw-key upgrades require the documented
non-overlap window: block sensitive traffic until 60 minutes after the final old
authentication limiter write and 35 seconds after the final old assistant
admission. Do not dual-write or fall back to raw keys.

The assistant reads only `docs/assistant-public`, refuses unsupported questions,
uses server-selected sources, and does not persist prompts, history, excerpts,
answers, or provider responses. Users must not submit confidential data.

## Logging and secrets

Pino logs server-owned request ID, method, and query-free path through an
allowlist; credentials, cookies, CSRF headers, prompts, URLs, and bodies are
redacted or omitted. Public errors are non-cacheable problem details with safe
codes. Secrets stay in ignored local env files or provider secure UIs. CI receives
no Atlas, Gemini, Render, cookie, or administrator secrets. Deterministic scans
cover tracked worktree bytes and reachable Git blobs without printing matches.

## Non-goals and reporting

This assessment does not implement MFA, verification/reset email delivery,
account recovery, malware scanning, or organization tenancy. Report a suspected
vulnerability privately to the repository owner through GitHub Security
Advisories; do not open a public issue containing exploit details or secrets.
