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
- `OPENROUTER_MAX_COMPLETION_TOKENS`
- `OPENROUTER_TEMPERATURE`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Sokosumi worker:

- `SOKOSUMI_API_URL`
- `SOKOSUMI_COWORKER_API_KEY`
- `SOKOSUMI_TASK_POLLER_ENABLED`
- `SOKOSUMI_TASK_POLL_INTERVAL_MS`
- `SOKOSUMI_TASK_POLL_LIMIT`
- `SOKOSUMI_TASK_POLL_MAX_PAGES`

Local/test helpers:

- `PI_AGENT_MOCK_RESPONSES=true` returns deterministic replies without model calls.
- `SOKOSUMI_MOCK_ENDPOINT_ENABLED=true` enables `POST /sokosumi/mock-task` for local smoke tests.

The Sokosumi extension lives in [`masumi-network/pi-sokosumi`](https://github.com/masumi-network/pi-sokosumi).
