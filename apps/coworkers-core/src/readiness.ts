import fs from "node:fs";
import path from "node:path";
import type { RuntimeConfig } from "./config.js";
import { AGENT_ID } from "./types.js";

export type RuntimeReadiness = {
  ok: boolean;
  checks: Record<string, boolean>;
};

export function getRuntimeReadiness(config: RuntimeConfig): RuntimeReadiness {
  const checks = {
    modelConfigured: config.piAgentMockResponses || Boolean(config.openRouterApiKey),
    authConfigured: !config.coworkersRequireAuth || Boolean(config.coworkersApiKey),
    sokosumiPollingConfigured: !config.sokosumiTaskPollerEnabled || Boolean(config.sokosumiCoworkerApiKey),
    promptConfigured: hasPrompt(config.promptRoot, AGENT_ID)
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
}

function hasPrompt(promptRoot: string, agentId: string) {
  return fs.existsSync(path.join(promptRoot, agentId, "agent.yaml")) &&
    fs.existsSync(path.join(promptRoot, agentId, "identity.md")) &&
    fs.existsSync(path.join(promptRoot, agentId, "expertise.md"));
}
