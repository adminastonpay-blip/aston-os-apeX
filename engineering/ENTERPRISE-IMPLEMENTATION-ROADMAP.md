# ASTON OS Omni-Core — Enterprise Implementation Roadmap

This roadmap is deliberately staged. Security and correctness gates precede autonomous behavior and optional convenience features.

## Phase 0 — reproducible validation
- Pin Wrangler and Node versions; commit the package lockfile.
- Add PR validation: JavaScript syntax, tests, Wrangler dry-run, configuration checks.
- Separate local, staging, and production configuration.
- Keep deploy workflow manual or protected; do not deploy from an audit branch.

## Phase 1 — tenant security foundation (P0)
- Replace shared-token-only identity with validated credentials and explicit scopes.
- Derive tenant identity from verified claims; reject caller-controlled tenant overrides.
- Namespace sessions, records, cache keys, exports, and audit events by tenant and subject.
- Configure strict CORS allowlists; do not use CORS as authorization.
- Define role matrix: platform_admin, tenant_admin, operator, analyst, viewer, ai_only, ledger_reader, ledger_writer.
- Add rate limits by tenant, route, and operation; enforce stricter limits for writes and AI.
- Add request IDs, structured redacted logs, and consistent error responses.

## Phase 2 — durable data and ledger correctness (P0)
- Introduce idempotency keys for all write/ledger operations.
- Add tenant IDs, actor IDs, correlation IDs, schema version, and timestamps to audit events.
- Define a single source of truth for financial records; implement explicit replication/reconciliation instead of assuming two D1 bindings are synchronized.
- Use transactional writes where supported and document what is not atomic across D1/R2/Queues.
- Define retention, deletion, export, backup encryption, restore drills, and recovery objectives.
- Validate payload byte size while streaming; add schema validation per sector.

## Phase 3 — execution and workflows
- Implement a server-side allowlist of model tools. The model may request a tool, but only the backend can authorize and execute it.
- Validate tool arguments against schemas, scope each tool to the tenant, apply timeouts and quotas, and require human approval for high-impact operations.
- Use Queues for asynchronous jobs with idempotent consumers, bounded retries, dead-letter strategy, and replay tooling.
- Use Workflows/Durable Objects only where their state and consistency model fits the use case.
- Add signed outbound webhooks with retry schedules and replay protection.

## Phase 4 — search, memory, and intelligence
- Add tenant-scoped durable conversation memory with retention controls and deletion semantics.
- Add Vectorize only after indexing, tenant filtering, metadata filtering, and access-control behavior are tested.
- Implement hybrid retrieval (semantic + structured filters) with citations/provenance where applicable.
- Configure supported AI models per environment; test availability and schema compatibility at runtime.
- Add agent policies, budgets, action ceilings, and escalation/approval rules.

## Phase 5 — operations and product polish
- Implement records pagination, filtering, sorting, version history, and soft-delete policy.
- Add JSON/CSV export jobs with tenant isolation and expiring download links.
- Add per-tenant usage counters, quotas, and billing metering with clear definitions.
- Add binding-specific diagnostics, health/readiness distinction, and service-level indicators.
- Add localization and per-tenant prompts only after security and prompt-injection boundaries are defined.
- Add cache only for safe, cacheable reads; never share sensitive tenant responses across cache keys.

## Definition of done
- Each feature has unit/integration tests and a documented permission model.
- Runtime dependencies are explicitly configured and tested in staging.
- No secret appears in source, logs, test fixtures, or workflow output.
- Production deployment requires review and explicit approval.
- Operational claims are based on measured evidence, not configuration presence alone.
