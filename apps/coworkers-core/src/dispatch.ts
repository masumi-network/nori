import type { RuntimeConfig } from "./config.js";
import { runPiCoworkerAgent } from "./agentRunner.js";
import { buildSystemPrompt } from "./prompts.js";
import type { CoworkerRequest, CoworkerResult } from "./types.js";
import { CoworkerRequestError, isSupportedSurface, promptModeForSurface } from "./types.js";

export type CoworkerAgentRunner = (input: {
  request: CoworkerRequest;
  systemPrompt: string;
  config: RuntimeConfig;
}) => Promise<CoworkerResult>;

export async function dispatchCoworkerRequest(
  request: CoworkerRequest,
  config: RuntimeConfig,
  runner: CoworkerAgentRunner = runPiCoworkerAgent
): Promise<CoworkerResult> {
  validateCoworkerRequest(request);
  const prompt = await buildSystemPrompt({
    promptRoot: config.promptRoot,
    agentId: request.agentId,
    surface: request.surface,
    mode: promptModeForSurface(request.surface)
  });
  return runner({ request, systemPrompt: prompt.systemPrompt, config });
}

function validateCoworkerRequest(request: CoworkerRequest) {
  if (!request?.agentId) throw new CoworkerRequestError("agentId is required.");
  if (!request?.surface) throw new CoworkerRequestError("surface is required.");
  if (!isSupportedSurface(request.agentId, request.surface)) {
    throw new CoworkerRequestError(`${request.agentId} does not support surface ${request.surface}.`);
  }
  if (!String(request.userId || "").trim()) throw new CoworkerRequestError("userId is required.");
  if (!String(request.message || "").trim()) throw new CoworkerRequestError("message is required.");
}
