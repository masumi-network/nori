import fs from "node:fs";
import path from "node:path";

export type RuntimeConfig = {
  port: number;
  promptRoot: string;
  coworkersApiKey: string;
  coworkersRequireAuth: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  piAgentMockResponses: boolean;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterBaseUrl: string;
  openRouterMaxCompletionTokens: number;
  openRouterTemperature: number;
  openRouterSiteUrl: string;
  openRouterAppName: string;
  deploymentSmokeTestEnabled: boolean;
  deploymentSmokeTimeoutMs: number;
  sokosumiApiUrl: string;
  sokosumiCoworkerApiKey: string;
  sokosumiTaskPollerEnabled: boolean;
  sokosumiTaskPollIntervalMs: number;
  sokosumiTaskPollLimit: number;
  sokosumiTaskPollMaxPages: number;
  sokosumiMockEndpointEnabled: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const hasSokosumiKey = Boolean(env.SOKOSUMI_COWORKER_API_KEY);
  const isRailwayRuntime = Boolean(
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_ENVIRONMENT_NAME ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID
  );

  return {
    port: parsePositiveInteger(env.PORT, 3000),
    promptRoot: env.COWORKER_PROMPT_ROOT || defaultPromptRoot(),
    coworkersApiKey: env.COWORKERS_API_KEY || "",
    coworkersRequireAuth: parseBoolean(env.COWORKERS_REQUIRE_AUTH, true),
    rateLimitWindowMs: parsePositiveInteger(env.COWORKERS_RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMaxRequests: parsePositiveInteger(env.COWORKERS_RATE_LIMIT_MAX_REQUESTS, 60),
    piAgentMockResponses: parseBoolean(env.PI_AGENT_MOCK_RESPONSES, false),
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
    openRouterModel: env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
    openRouterBaseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    openRouterMaxCompletionTokens: parsePositiveInteger(env.OPENROUTER_MAX_COMPLETION_TOKENS, 1200),
    openRouterTemperature: parseNumber(env.OPENROUTER_TEMPERATURE, 0.4),
    openRouterSiteUrl: env.OPENROUTER_SITE_URL || "",
    openRouterAppName: env.OPENROUTER_APP_NAME || "Nori Pi Agent",
    deploymentSmokeTestEnabled: parseBoolean(env.NORI_DEPLOYMENT_SMOKE_TEST_ENABLED, isRailwayRuntime),
    deploymentSmokeTimeoutMs: parsePositiveInteger(env.NORI_DEPLOYMENT_SMOKE_TIMEOUT_MS, 75000),
    sokosumiApiUrl: env.SOKOSUMI_API_URL || "https://api.preprod.sokosumi.com",
    sokosumiCoworkerApiKey: env.SOKOSUMI_COWORKER_API_KEY || "",
    sokosumiTaskPollerEnabled: parseBoolean(env.SOKOSUMI_TASK_POLLER_ENABLED, hasSokosumiKey),
    sokosumiTaskPollIntervalMs: parsePositiveInteger(env.SOKOSUMI_TASK_POLL_INTERVAL_MS, 15000),
    sokosumiTaskPollLimit: parsePositiveInteger(env.SOKOSUMI_TASK_POLL_LIMIT, 20),
    sokosumiTaskPollMaxPages: parsePositiveInteger(env.SOKOSUMI_TASK_POLL_MAX_PAGES, 10),
    sokosumiMockEndpointEnabled: parseBoolean(env.SOKOSUMI_MOCK_ENDPOINT_ENABLED, false)
  };
}

function defaultPromptRoot() {
  const candidates = [
    path.join(process.cwd(), "src", "agents"),
    path.resolve(process.cwd(), "..", "..", "src", "agents")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
