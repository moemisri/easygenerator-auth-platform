# Authentication

Users create an account with an email address, display name, and password. Sign-in failures use a uniform response so the API does not reveal whether an account exists or is disabled.

## Sessions

Successful sign-up and sign-in create a server-side session. The browser receives an opaque session cookie. Session resolution accepts only an unexpired, unrevoked session belonging to an active user.

## Cookies

Session cookies are HTTP-only, use `SameSite=Strict`, and apply to the entire application. Production cookies are secure and use the host-only cookie naming convention. Signing out clears the cookie and revokes the corresponding server-side session.

## Cross-Site Request Forgery Protection

Authenticated state-changing requests require a CSRF token associated with the session. The API also checks the request origin and compatible Fetch Metadata. Requests with missing or incompatible evidence are rejected before the mutation runs.

## Credential Protection

Passwords are hashed before storage and are never returned by public APIs. Authentication rate limits use privacy-preserving keys and fail closed when their protection service is unavailable.
