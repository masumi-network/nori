import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RuntimeConfig } from "./config.js";
import { CoworkerRequestError } from "./types.js";

export function assertAuthorized(req: IncomingMessage, config: RuntimeConfig) {
  if (!config.coworkersRequireAuth) return;
  if (!config.coworkersApiKey) {
    throw new CoworkerRequestError("COWORKERS_API_KEY is required when COWORKERS_REQUIRE_AUTH is enabled.", 503);
  }

  const provided = extractProvidedKey(req);
  if (!provided || !safeEqual(provided, config.coworkersApiKey)) {
    throw new CoworkerRequestError("Unauthorized.", 401);
  }
}

function extractProvidedKey(req: IncomingMessage) {
  const authorization = headerValue(req, "authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return headerValue(req, "x-coworkers-api-key") || headerValue(req, "x-api-key") || "";
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
