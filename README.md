# Nori Agent

Independent Railway-deployed TypeScript Pi runtime for Nori, the Masumi/Sokosumi/Kodosumi DevRel agent.

## Runtime

- Package manager: `pnpm@10.33.0`
- Node: `>=22.19.0`
- Core app: `apps/coworkers-core`
- Agent prompts: `src/agents/nori`
- Sokosumi Pi extension: `@masumi-network/pi-sokosumi`
- Pi package registration: `.pi/settings.json`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm start` runs the Railway HTTP service. It consumes `PORT` and exposes:

- `GET /healthz`
- `POST /v1/chat`
- `POST /webhooks/email`
- `POST /webhooks/telegram`
- `POST /webhooks/discord`
- `POST /webhooks/github`
- `POST /webhooks/twitter`
- `POST /webhooks/sokosumi`
- legacy-compatible `POST /webhooks/nori/:surface`

All POST routes require `Authorization: Bearer $COWORKERS_API_KEY` or `X-Coworkers-Api-Key: $COWORKERS_API_KEY` unless `COWORKERS_REQUIRE_AUTH=false` is set for local development.

Inbound requests default to `agentId: "nori"` if no agent is supplied.

## Environment

Required for real model calls:

- `COWORKERS_API_KEY`
- `COWORKERS_REQUIRE_AUTH`
- `COWORKERS_RATE_LIMIT_WINDOW_MS`
- `COWORKERS_RATE_LIMIT_MAX_REQUESTS`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MAX_COMPLETION_TOKENS` (defaults to `8000`)
- `OPENROUTER_TEMPERATURE`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Deployment gate:

- `NORI_DEPLOYMENT_SMOKE_TEST_ENABLED`
- `NORI_DEPLOYMENT_SMOKE_TIMEOUT_MS`

On Railway, the deployment smoke suite is enabled by default. At startup it sends an authenticated multi-turn request through the real local `POST /v1/chat` route with history that ends in an assistant message. The request asks the configured model to return a unique per-deployment marker and must report non-zero model token usage. `GET /healthz` remains `503` until the check passes, so Railway cannot promote a deployment that serves only a canned response, cannot call the model, or cannot replay assistant history. Set `NORI_DEPLOYMENT_SMOKE_TEST_ENABLED=false` only as an explicit emergency override.

Sokosumi worker:

- `SOKOSUMI_API_URL`
- `SOKOSUMI_COWORKER_API_KEY`
- `SOKOSUMI_TASK_POLLER_ENABLED`
- `SOKOSUMI_TASK_POLL_INTERVAL_MS`
- `SOKOSUMI_TASK_POLL_LIMIT`
- `SOKOSUMI_TASK_POLL_MAX_PAGES`

Masumi payment requests for DevHub chat:

- `NORI_DOCS_PAYMENT_ENABLED` (defaults to enabled on Railway and disabled locally)
- `MASUMI_PAYMENT_API_URL`
- `MASUMI_PAYMENT_API_TOKEN` or `MASUMI_PAYMENT_API_KEY`
- `MASUMI_AGENT_IDENTIFIER` (or `NORI_AGENT_IDENTIFIER`)
- `MASUMI_NETWORK` (`Preprod` or `Mainnet`)
- `MASUMI_PAYMENT_TIMEOUT_MS`

For `surface: "docs"`, `/v1/chat` creates a seller-side fixed-price Masumi
payment request after the model completes and returns it as
`paymentEvent.masumiPayment`. Nori's registered on-chain price is authoritative,
so the request intentionally omits `RequestedFunds`. Payment creation fails
closed: an enabled but incomplete configuration, a payment-service failure, or
a malformed payment response makes the chat request fail instead of returning a
paid answer without a usable payment event. Railway deployment smoke checks also
require a valid payment event whenever docs payments are enabled.

Local/test helpers:

- `PI_AGENT_MOCK_RESPONSES=true` returns deterministic replies without model calls.
- `SOKOSUMI_MOCK_ENDPOINT_ENABLED=true` enables `POST /sokosumi/mock-task` for local smoke tests.

The Sokosumi extension lives in [`masumi-network/pi-sokosumi`](https://github.com/masumi-network/pi-sokosumi).
