# Deployment

The application is designed to run as a single web service with separate MongoDB and Redis dependencies. Runtime configuration validates public origins, database and cache connection URLs, cryptographic secrets, proxy trust, cookie security, and optional assistant settings before the service starts.

## Health Checks

`GET /health/live` reports whether the process is running. `GET /health/ready` checks MongoDB and Redis with short deadlines and reports each dependency as up or down. A failed MongoDB readiness check produces an unavailable status; a degraded dependency is always visible in the response.

## Secure Transport

Production configuration requires HTTPS origins and secure session cookies. Proxy trust is an explicit bounded hop count rather than an unrestricted setting.

## Assistant Configuration

The assistant is disabled by default. Enabling it requires a Gemini API key and model name during configuration. Provider settings are server-only and are never included in authentication, session, or assistant responses.

## Operational Privacy

Application logs redact credentials, cookies, CSRF tokens, connection URLs, assistant messages, assistant history, and provider keys. Assistant cache entries contain only public section identifiers; they do not contain prompts, excerpts, history, generated text, or raw provider responses.
