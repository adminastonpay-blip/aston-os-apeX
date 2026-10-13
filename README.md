# ASTON OS Omni-Core (v7.0.1)

Cloudflare Workers edge service with Workers AI, D1, R2, KV, Queues, scheduled telemetry, sector ingestion, records, and a transaction ledger.

## Endpoints

| Route | Method | Authentication |
|---|---|---|
| `/` | GET | Public |
| `/health` | GET | Public |
| `/v1/ingest/:sector` | POST | Bearer token |
| `/chat`, `/api/chat`, `/v1/ai/chat` | POST | Bearer token unless `ASTON_PUBLIC_CHAT=true` |
| `/v1/records/:sector` | GET / POST | Bearer token; use `X-Aston-Tenant` |
| `/v1/ledger` | POST | Bearer token |

Sectors: `primary, industry, infra, fintech, govtech, health, mobility, media`.

## Local setup

1. Install Node.js LTS.
2. Run `npm install`.
3. Authenticate: `npx wrangler login`.
4. Check `wrangler.toml` bindings and IDs against your Cloudflare account.
5. Create the Queue if needed: `npm run queue:create`.
6. Initialize the configured D1 databases: `npm run db:init`.
7. Add the API token: `npx wrangler secret put ASTON_API_TOKEN`.
8. Test locally: `npm run dev`.
9. Deploy: `npm run deploy`.

## GitHub Actions deployment

The workflow in `.github/workflows/deploy.yml` deploys on pushes to `main` and manual dispatch. Configure these repository Actions secrets:

- `CLOUDFLARE_API_TOKEN` — scoped to the required Workers and resource permissions.
- `CLOUDFLARE_ACCOUNT_ID`.

Also configure `ASTON_API_TOKEN` as a Worker secret in Cloudflare (or with Wrangler). Never commit secrets.

**Important:** This repository's workflow deploys the Worker only. Confirm resource bindings, D1 IDs, Queue existence, R2 bucket, KV namespace, and Workers AI access before deployment. Do not assume the IDs in `wrangler.toml` exist in another account.

## Smoke tests

```bash
curl https://aston-omni-core.<your-subdomain>.workers.dev/health

curl -X POST https://aston-omni-core.<your-subdomain>.workers.dev/v1/ledger \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sender":"account-a","recipient":"account-b","amount":10,"currency":"USD"}'
```

Optional non-secret variables: `ASTON_ALLOWED_ORIGIN`, `ASTON_PUBLIC_CHAT`, `ASTON_AI_MODEL`.

Keep this repository private if it contains internal implementation details.
