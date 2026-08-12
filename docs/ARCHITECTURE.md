# Architecture

## Modular monolith

The pnpm workspace contains a React/Vite browser, NestJS API, and shared Zod
contracts. Nest modules separate platform configuration/logging/database/Redis
from auth, users, audit, admin, health, and assistant domains. Controllers own
transport concerns, services own policy/use cases, repositories own persistence,
and shared contracts define public request/response boundaries.

Production uses one container and origin: Nest serves `apps/api/public`, API
routes remain under `/api/v1`, health remains under `/health`, real assets are
served exactly, and browser routes fall back to the SPA. API, health, and missing
assets never fall back to HTML.

## Request and session flow

The HTTP boundary assigns a request ID, sanitizes logging paths, applies Helmet,
strict JSON limits, validation, origin checks, and problem mapping. Signup/signin
validate shared contracts, apply Redis protection, hash/verify passwords, then
transactionally create user/session/audit state. The browser stores no bearer
token: it receives an opaque HttpOnly cookie and session-bound CSRF token.
Protected requests resolve the session and current active user from MongoDB.

## Administrator invariant

Admin reads require capabilities. Mutations pass session, CSRF, capability, and
Redis actor/IP protection in order. The service uses optimistic versions plus a
transactional global security revision to serialize privileged changes. It
rechecks self-target and last-active-admin invariants inside the transaction,
updates the user, revokes affected sessions, and records a safe audit event.

## Assistant path

At startup, the loader reads only six committed public Markdown documents,
chunks ATX sections, and assigns stable IDs. Each request is session/CSRF/rate/
lease protected. Deterministic lexical retrieval selects at most four excerpts;
insufficient evidence produces a refusal without Gemini. Supported requests send
bounded browser history and public excerpts to Gemini. The API frames sources,
deltas, completion, or one safe error over POST SSE and releases the opaque lease
only after safe generator finalization.

## Decisions

Opaque server sessions were chosen over JWT refresh flows because immediate
revocation, disabled-user checks, and administrative role changes matter more
than stateless scale here. A modular monolith avoids distributed transactions and
operational overhead. Deterministic lexical retrieval avoids storing embeddings,
keeps sources auditable, and fits the small public corpus; vector storage would be
premature.
