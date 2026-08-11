# API

Application APIs use the `/api/v1` prefix. JSON request bodies are validated against strict shared schemas, so unknown fields and invalid bounds are rejected. Error responses use stable problem codes and include a server-owned request identifier.

## Authentication Endpoints

The authentication API supports sign-up, sign-in, current-session retrieval, and sign-out. Successful authentication responses contain a safe user view, a CSRF token, and public feature flags. They never expose password hashes, session storage records, provider credentials, or assistant model configuration.

## Current User Endpoint

The current-user endpoint returns the safe user attached by the session guard. It requires a valid active session and prevents caching of the response.

## Administration Endpoints

Authorized staff can list users with bounded pagination, search, and sorting. Authorized managers and administrators can submit versioned role or status changes. Audit readers receive safe summaries rather than raw metadata.

## Assistant Chat Endpoint

`POST /api/v1/assistant/chat` accepts a message and at most six prior user or assistant history items. Each text value is bounded. The route requires a valid session, same-origin request evidence, and a valid CSRF token.

The response is a Server-Sent Events stream. The first event is `sources`; supported answers may then contain `delta` events and finish with `done`. Unsupported questions return empty sources and a refused completion without calling Gemini. A provider or deadline failure ends with a safe `error` event and no completion event.

## Problem Responses

Failures detected before streaming return a non-cacheable problem response. Stable codes distinguish validation, authentication, CSRF, feature availability, rate limiting, concurrent streams, corpus availability, and protection-service availability.
