import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPiAgentChatRouteHandler } from "@masumi-network/pi-sokosumi/chat";
import { assertAuthorized } from "./auth.js";
import { loadConfig } from "./config.js";
import { dispatchCoworkerRequest } from "./dispatch.js";
import { normalizeChatRequest, normalizeWebhookRequest } from "./normalization.js";
import { assertWithinRateLimit } from "./rateLimit.js";
import { getRuntimeReadiness } from "./readiness.js";
import { createSokosumiTaskRequest, startCoworkerSokosumiWorker } from "./sokosumi.js";
import { AGENT_DESCRIPTION, AGENT_DISPLAY_NAME, AGENT_ID, CoworkerRequestError, normalizeCoworkerId, normalizeSurface } from "./types.js";

const config = loadConfig();
const chatRoute = createPiAgentChatRouteHandler({
  authorize: ({ req }) => assertAuthorized(req, config),
  rateLimit: ({ req }) => assertWithinRateLimit(req, config),
  normalizeRequest: ({ body, headers }) => normalizeChatRequest(body, headers),
  handleChat: async ({ request }) => dispatchCoworkerRequest(request, config)
});

startCoworkerSokosumiWorker({ config });

const server = http.createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error: any) {
    const statusCode = error instanceof CoworkerRequestError ? error.statusCode : 500;
    sendJson(res, statusCode, {
      error: error?.message || "Internal server error"
    });
  }
});

server.listen(config.port, () => {
  console.log(JSON.stringify({
    event: "coworkers_core_started",
    port: config.port,
    agent: AGENT_ID
  }));
});

async function routeRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    const readiness = getRuntimeReadiness(config);
    return sendJson(res, readiness.ok ? 200 : 503, {
      status: readiness.ok ? "ok" : "degraded",
      runtime: "pi-agent",
      agent: {
        id: AGENT_ID,
        name: AGENT_DISPLAY_NAME,
        description: AGENT_DESCRIPTION
      },
      checks: readiness.checks,
      sokosumi: {
        pollerEnabled: config.sokosumiTaskPollerEnabled,
        mode: config.sokosumiCoworkerApiKey ? "api" : "mock"
      }
    });
  }

  if (await chatRoute(req, res)) return;

  if (req.method !== "POST") {
    return sendJson(res, 404, { error: "Not found" });
  }

  assertAuthorized(req, config);
  assertWithinRateLimit(req, config);

  const body = await readJson(req);

  if (url.pathname === "/sokosumi/mock-task" && config.sokosumiMockEndpointEnabled) {
    const request = createSokosumiTaskRequest({ task: body?.task || body, event: body?.event || {} });
    const result = await dispatchCoworkerRequest(request, config);
    return sendJson(res, 200, result);
  }

  const webhookMatch = url.pathname.match(/^\/webhooks\/([^/]+)(?:\/([^/]+))?$/);
  if (webhookMatch) {
    const agentId = webhookMatch[2] ? normalizeCoworkerId(webhookMatch[1]) : AGENT_ID;
    if (!agentId) throw new CoworkerRequestError("Unsupported coworker in webhook route.");
    if (agentId !== AGENT_ID) throw new CoworkerRequestError(`This runtime only supports ${AGENT_ID}.`);
    const surface = normalizeSurface(agentId, webhookMatch[2] || webhookMatch[1]);
    if (!surface) throw new CoworkerRequestError("Unsupported webhook surface.");
    const request = normalizeWebhookRequest({ agentId, surface, body, headers: req.headers });
    const result = await dispatchCoworkerRequest(request, config);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new CoworkerRequestError("Request body is too large.", 413);
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new CoworkerRequestError("Request body must be valid JSON.");
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body)}\n`);
}
