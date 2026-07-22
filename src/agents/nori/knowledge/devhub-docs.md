# Current Developer Portal Docs

The current official Masumi and Sokosumi developer docs live at:

https://www.masumi.network/dev

Use that host for user-facing citations. Do not cite Railway preview URLs, `docs.masumi.network`, or `docs.sokosumi.com` unless a user explicitly asks about legacy docs.

Machine-readable docs entry points:

- Concise index: https://www.masumi.network/dev/llms.txt
- Full corpus: https://www.masumi.network/dev/llms-full.txt
- Markdown index: https://www.masumi.network/dev/md-index

## Sokosumi Coworkers

For questions like "how do I create a coworker on Sokosumi", "connect a coworker", "register a coworker", or "use a coworker API key", use the Sokosumi coworker docs, not the Masumi marketplace listing flow.

Primary guide:

https://www.masumi.network/dev/sokosumi/documentation/coworkers

API reference:

https://www.masumi.network/dev/sokosumi/api-reference/coworkers/coworkers/get

Important coworker endpoints:

- `POST /coworkers` - create the coworker profile with an admin API key.
- `PATCH /coworkers/{id}/whitelist` - whitelist or unwhitelist the coworker.
- `POST /coworkers/{id}/api-keys` - create a dedicated coworker runtime token.
- `GET /coworkers/me` - verify the coworker token from the agent runtime.
- `GET /coworkers/me/events` - fetch assigned task events for task coworkers.
- `POST /coworkers/me/usage` - report billable usage for completed coworker work.

Authoritative coworker setup flow:

1. Create the coworker profile in Sokosumi with an admin API key, or use `sokosumi coworkers register`.
2. Set `capabilities` to `chat`, `tasks`, or both.
3. For `chat`, provide a public OpenAI Responses-compatible `baseURL`.
4. For `tasks`, run a worker process that polls events, updates task status, and reports usage.
5. Whitelist the coworker before users can use it.
6. Create a dedicated coworker API key and store it as `SOKOSUMI_COWORKER_API_KEY`.
7. Verify from the runtime with `GET /coworkers/me`.

The running agent should use the coworker API key, not a human user's API key.

Task coworkers should poll `GET /coworkers/me/events`, create task events on the task, and report usage through `POST /coworkers/me/usage` with a stable idempotency key such as `usage:{taskId}:{eventId}:{action}`.

Chat coworkers need `capabilities: ["chat"]` and a non-null `baseURL`. Sokosumi forwards chat requests to the coworker's OpenAI Responses-compatible endpoint and includes delegation headers that identify the Sokosumi user and organization the coworker is acting for.

## Pi Sokosumi / PySokosumi

Primary guide:

https://www.masumi.network/dev/sokosumi/documentation/pysokosumi

Some people call this "PySokosumi", but the current public helper is a TypeScript package for Pi-based agents:

`@masumi-network/pi-sokosumi`

Install from GitHub until the package is published to npm:

```bash
pnpm add github:masumi-network/pi-sokosumi
```

Configure a Pi coworker runtime with:

```bash
export SOKOSUMI_API_URL=https://api.sokosumi.com
export SOKOSUMI_COWORKER_API_KEY=coworker_...
export SOKOSUMI_TASK_POLLER_ENABLED=true
```

For preprod testing:

```bash
export SOKOSUMI_API_URL=https://api.preprod.sokosumi.com
```

Pi Sokosumi provides reusable runtime infrastructure: a Sokosumi HTTP coworker client, task poller, direct chat helper, identity extraction helpers, and Masumi completion-payment helpers. Agent-specific behavior still belongs in the agent prompt, tools, model calls, and callbacks.

When answering coworker setup questions, cite the coworker guide and Pi Sokosumi guide above.
