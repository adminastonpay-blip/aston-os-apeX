# ASTON OS Omni-Core v7.0.1 — Cloudflare Compatibility Audit

Date: 2026-10-14  
Scope: static review of `src/index.js`, `wrangler.toml`, `package.json`, `schema.sql`, and the existing deployment workflow.  
Environment: source repository only; no Cloudflare deployment was run by this audit.

## Executive status

**Static review: conditional pass for the Workers project shape; deployment acceptance is NOT YET VERIFIED.**

The repository uses a Cloudflare Workers module entry point (`src/index.js`) and Wrangler configuration. The source exports `fetch`, `scheduled`, and `queue` handlers and references D1, KV, R2, Workers AI, and Queues. These are recognizable Workers platform patterns. This does not prove that the configured resources exist, that identifiers belong to the intended account, that schemas are applied, or that every selected AI model is available to the account.

## Findings

### P0 — resolve before production traffic

1. **Tenant identity and authorization are insufficiently bound.** A shared `ASTON_API_TOKEN` is used, while `X-Aston-Tenant` is client supplied. A tenant header is not proof of tenant identity. Derive tenant and scopes from a verified credential (for example, a validated JWT with issuer, audience, expiry, and tenant claims); never trust a caller-supplied tenant header as authorization.
2. **Chat sessions are not tenant-scoped.** KV keys use `session:<sid>` and do not include a tenant/user namespace. A guessed or reused session ID could cross account boundaries. Use tenant + subject + session identifiers and enforce authorization before reading/writing history.
3. **CORS defaults to wildcard.** `headersFor()` uses `*` when `ASTON_ALLOWED_ORIGIN` is unset. Require an explicit allowlist for browser-facing production deployments and reject untrusted origins. CORS is not an authentication control.
4. **Ledger idempotency and audit guarantees are incomplete.** The ledger endpoint creates a random ID per request and does not accept an idempotency key. Retries can create duplicate business transactions. Add unique idempotency keys, a transaction state model, tenant attribution, and append-only audit evidence before calling this production-grade financial infrastructure.
5. **D1 fallback is not replication.** `writeWithFailover()` writes to the first database that succeeds. It does not atomically or asynchronously synchronize the other database, and a partial failure can leave data divergent. Define the source of truth, replication/reconciliation procedure, and tested recovery objectives.
6. **Async persistence is not awaited.** R2 writes and queue sends in several handlers use `ctx.waitUntil()`; the HTTP success response means accepted/scheduled, not that all secondary writes have completed. Expose explicit durability semantics and monitor failures.

### P1 — correctness and operations

7. **Schema and binding smoke tests are missing.** The health endpoint tests D1 with `SELECT 1` but checks R2, KV, Queue, and AI mostly by binding presence, not by a safe functional operation. Add a non-destructive diagnostic mode with clear dependency statuses.
8. **Queue consumer failure handling needs a policy.** Every failure calls `message.retry()`; repeated poison messages need bounded retries/dead-letter handling and observability.
9. **AI model fallback is unverified.** A list of model identifiers does not prove availability, entitlement, or compatibility with the expected request/response schema. Keep the model list configurable and test each enabled model against the actual account.
10. **Body-size checking should not rely on Content-Length.** The code also checks the parsed text length, which is good, but byte size should be bounded while streaming to avoid reading an oversized body fully into memory. Validate field types and limits per route/sector.
11. **Record API needs full query validation.** Add explicit pagination limits, allowed sort fields, filter validation, tenant-scoped cursors, and consistent 400/405/413 responses.
12. **Telemetry headers are incomplete.** The request ID appears in JSON bodies but not as a standard response header. Add `X-Request-Id`, edge colo when available, and tenant metadata only after trusted authentication.
13. **Current workflow deploys from `main` using an older action major.** Add a separate validation-only workflow for branches/PRs. Production deployment must remain gated and use GitHub Secrets; never commit Cloudflare tokens or account credentials.

### P2 — planned capabilities, not currently implemented

- Executable model tool calling with strict allowlisted tools, argument schemas, authorization checks, timeouts, and idempotency.
- Durable multi-step workflows and approval gates for sensitive operations.
- RBAC and scoped permissions per tenant, user, sector, and operation.
- Tamper-evident audit events (hash chaining/signatures plus restrictive write access; a hash alone does not make storage immutable).
- Webhooks with signatures, replay protection, retries, and delivery logs.
- Cron/delayed jobs with deduplication.
- Vectorize hybrid search; the current Wrangler configuration does not declare a Vectorize binding.
- Tenant-specific encryption and key rotation.
- Usage accounting, export jobs, and configurable quotas.

## Configuration review

- `main = "src/index.js"`: consistent with the source tree inspected.
- `compatibility_date = "2026-03-01"`: syntactically plausible, but older than the audit date. Upgrade only after testing the intended runtime behavior and compatibility changes.
- D1, KV, R2, and Queue names/IDs are present in configuration. Their existence, account ownership, permissions, and production data state were not verified.
- The schema defines `enterprise_records`, `ledger_transactions`, and `events`. It should be applied and tested against each intended database; the presence of `schema.sql` does not prove it has been applied.
- The project has no lockfile visible in the inspected source files. Add and commit a package lockfile for reproducible CI installs.

## Acceptance gates

1. `npm ci` succeeds with a committed lockfile.
2. `node --check src/index.js` succeeds.
3. Wrangler dry-run/build validates the configuration without deploying.
4. D1 schema and index checks pass against a non-production/staging database.
5. Binding smoke tests run in staging and distinguish missing bindings from failed operations.
6. Automated tests prove cross-tenant isolation, auth failures, CORS allowlist behavior, request-size enforcement, idempotency, queue retry limits, and ledger recovery.
7. Security review passes before production deployment.

## What this audit does not claim

This report does not claim a successful Cloudflare deployment, live resource connectivity, load-test results, compliance certification, immutable storage, or production readiness. Those require runtime evidence and environment-specific checks.
