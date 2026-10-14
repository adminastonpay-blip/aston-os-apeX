# Implemented enhancements — audit branch

This branch now contains code changes in addition to the static audit and roadmap. It is based on the existing Omni-Core v7.0.1 source and is intended for review/testing before merge.

## Implemented in source

- **Records pagination:** `GET /v1/records/{sector}?limit=50&offset=0`; limit is bounded to 1–100 and offset to 0–1,000,000.
- **Records filtering:** optional `title`, `from`, and `to` filters. Dates must parse as ISO-compatible date/time strings.
- **Safe sorting:** only `created_at` and `title` are accepted, with `asc` or `desc`; SQL values are bound parameters and sort identifiers are allowlisted.
- **Stats endpoint:** authenticated `GET /v1/stats` reports tenant-filtered record totals, last-24-hour record count, and counts by sector. Dependency fields explicitly say `binding_present` rather than claiming the service was functionally tested.
- **Response telemetry:** normal and error responses include `X-Request-Id`; `X-Edge-Colo` is included when Cloudflare supplies a valid colo code.
- **CORS default hardened:** wildcard origin fallback removed. Browser origins are allowed only when listed in `ASTON_ALLOWED_ORIGIN` (comma-separated exact origins). Configure the production storefront origin before browser use.
- **Session namespace improvement:** KV session keys include a normalized tenant namespace to reduce accidental collisions between tenant-labelled sessions.

## Important remaining blockers

These changes do **not** complete enterprise authentication. The existing shared API token and caller-supplied `X-Aston-Tenant` header remain insufficient to prove tenant identity. A validated JWT/identity layer and server-derived tenant claims are still required before exposing multi-tenant data to untrusted customers. Session namespacing is defense-in-depth, not authorization.

Also still pending: ledger idempotency and tenant attribution, real RBAC, signed webhooks, bounded queue retries/dead-letter policy, transactional or reconciled D1 recovery, full body streaming limits, automated unit/integration tests, and live staging binding tests.

## API examples

Records page:

```http
GET /v1/records/fintech?limit=25&offset=0&sort=created_at&direction=desc
Authorization: Bearer <configured-token>
X-Aston-Tenant: <tenant>
```

Filter by title/date:

```http
GET /v1/records/fintech?title=settlement&from=2026-10-01T00:00:00Z&to=2026-10-14T23:59:59Z
```

Tenant record statistics:

```http
GET /v1/stats
Authorization: Bearer <configured-token>
X-Aston-Tenant: <tenant>
```

Do not place real tokens in source control, issue comments, logs, or chat messages.
