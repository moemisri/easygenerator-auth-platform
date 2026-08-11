# Architecture

The platform is a TypeScript workspace with separate browser, API, and shared-contract packages. The API is a NestJS application. Shared Zod schemas define request and response boundaries used by both the API and browser.

## Application Boundaries

The browser communicates with versioned endpoints under `/api/v1`. Authentication and authorization decisions remain on the server. The server validates structured input and returns stable problem details for rejected requests.

## Data Services

MongoDB stores users, sessions, and audit events. Redis provides protective rate limits and short-lived coordination. Redis is not authoritative for sessions or roles.

## Assistant Retrieval

The documentation assistant loads a fixed set of committed public Markdown files. It splits documents at ATX headings, assigns stable section identifiers, and ranks sections using normalized lexical terms. It does not browse arbitrary files, follow links, search the web, or ask Gemini to choose sources.

## Assistant Streaming

Assistant responses use Server-Sent Events over an authenticated POST request. A stream begins with server-selected sources, may contain text deltas, and ends with one completion or safe error event. Only JSON-framed event data crosses this boundary.
