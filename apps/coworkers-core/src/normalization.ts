import type { IncomingHttpHeaders } from "node:http";
import type { CoworkerId, CoworkerRequest, CoworkerSurface } from "./types.js";
import { AGENT_ID, CoworkerRequestError, normalizeCoworkerId, normalizeSurface } from "./types.js";

export function normalizeWebhookRequest({
  agentId,
  surface,
  body,
  headers = {}
}: {
  agentId?: unknown;
  surface?: unknown;
  body: any;
  headers?: IncomingHttpHeaders;
}): CoworkerRequest {
  const normalizedAgentId = normalizeCoworkerId(
    agentId ||
    body?.agentId ||
    body?.agent_id ||
    body?.coworker ||
    body?.metadata?.agentId ||
    body?.metadata?.coworker ||
    AGENT_ID
  );
  if (!normalizedAgentId) {
    throw new CoworkerRequestError(`Unsupported coworker. This runtime only supports agentId ${AGENT_ID}.`);
  }

  const normalizedSurface = normalizeSurface(normalizedAgentId, surface || body?.surface || body?.interface || "chat");
  if (!normalizedSurface) {
    throw new CoworkerRequestError(`Unsupported surface for ${normalizedAgentId}.`);
  }

  return {
    agentId: normalizedAgentId,
    surface: normalizedSurface,
    userId: extractUserId(body, headers),
    organizationId: extractFirstString(
      body?.organizationId,
      body?.organization_id,
      body?.workspaceId,
      body?.workspace_id,
      body?.metadata?.organizationId,
      headerValue(headers, "x-organization-id"),
      headerValue(headers, "x-delegation-organization-id")
    ),
    message: extractMessage(body),
    attachments: Array.isArray(body?.attachments) ? body.attachments : undefined,
    metadata: {
      ...(body?.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      sourcePayloadType: detectPayloadType(body),
      routeSurface: normalizedSurface,
      sourcePayload: sanitizePayload(body)
    }
  };
}

export function normalizeChatRequest(body: any, headers: IncomingHttpHeaders = {}) {
  return normalizeWebhookRequest({
    agentId: body?.agentId || body?.agent_id,
    surface: body?.surface || "chat",
    body,
    headers
  });
}

function extractUserId(body: any, headers: IncomingHttpHeaders) {
  return extractFirstString(
    body?.userId,
    body?.user_id,
    body?.senderId,
    body?.sender_id,
    body?.from?.id,
    body?.from?.email,
    body?.sender?.id,
    body?.sender?.email,
    body?.message?.from?.id,
    body?.message?.from?.email,
    body?.metadata?.userId,
    headerValue(headers, "x-user-id"),
    headerValue(headers, "x-delegation-user-id"),
    "anonymous"
  ) as string;
}

function extractMessage(body: any) {
  const message = extractFirstString(
    body?.message,
    body?.text,
    body?.content,
    body?.body,
    body?.comment,
    body?.description,
    body?.message?.text,
    body?.message?.body,
    body?.email?.text,
    body?.email?.body,
    body?.comment?.body,
    body?.issue?.body,
    body?.issue?.title,
    body?.pull_request?.body,
    body?.pull_request?.title,
    body?.tweet?.text,
    body?.post?.text
  );
  return String(message || "").trim();
}

function detectPayloadType(body: any) {
  if (body?.issue || body?.pull_request) return "github";
  if (body?.tweet || body?.post) return "social";
  if (body?.email) return "email";
  if (body?.message) return "message";
  return "generic";
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|authorization|api[_-]?key|signature/i.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizePayload(child, depth + 1);
  }
  return result;
}

function extractFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name] || headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
