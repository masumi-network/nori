import type { IncomingMessage } from "node:http";
import type { RuntimeConfig } from "./config.js";
import { CoworkerRequestError } from "./types.js";

const buckets = new Map<string, { resetAt: number; count: number }>();

export function assertWithinRateLimit(req: IncomingMessage, config: RuntimeConfig, now = Date.now()) {
  if (config.rateLimitMaxRequests <= 0 || config.rateLimitWindowMs <= 0) return;

  const key = rateLimitKey(req);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { resetAt: now + config.rateLimitWindowMs, count: 1 });
    cleanup(now);
    return;
  }

  current.count += 1;
  if (current.count > config.rateLimitMaxRequests) {
    throw new CoworkerRequestError("Rate limit exceeded.", 429);
  }
}

function rateLimitKey(req: IncomingMessage) {
  const user = headerValue(req, "x-user-id") || headerValue(req, "x-delegation-user-id");
  return `${req.socket.remoteAddress || "unknown"}:${user || "anonymous"}`;
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function cleanup(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
