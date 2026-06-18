// @ts-nocheck
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import type { RuntimeConfig } from "./config.js";
import { createCoworkerRuntimeTools } from "./tools.js";
import type { CoworkerRequest, CoworkerResult } from "./types.js";
import { AGENT_DISPLAY_NAME } from "./types.js";

export async function runPiCoworkerAgent({
  request,
  systemPrompt,
  config
}: {
  request: CoworkerRequest;
  systemPrompt: string;
  config: RuntimeConfig;
}): Promise<CoworkerResult> {
  if (config.piAgentMockResponses) {
    return {
      agentId: request.agentId,
      reply: `[${AGENT_DISPLAY_NAME} mock reply] ${request.message}`,
      usage: []
    };
  }

  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required unless PI_AGENT_MOCK_RESPONSES=true.");
  }

  const toolEvents = [];
  const usage = [];
  const toolState = {
    toolResults: []
  };
  const model = createOpenRouterPiModel(config);
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "medium",
      tools: createCoworkerRuntimeTools(request, toolState),
      messages: toPiMessages(request.metadata?.messages)
    },
    streamFn: (streamModel, context, options) =>
      streamSimple(streamModel, context, {
        ...options,
        apiKey: config.openRouterApiKey,
        temperature: config.openRouterTemperature,
        maxTokens: config.openRouterMaxCompletionTokens,
        timeoutMs: 120000,
        headers: createOpenRouterHeaders(config)
      })
  });

  let replyText = "";
  agent.subscribe((event) => {
    const eventSummary = summarizePiEvent(event);
    if (eventSummary) toolEvents.push(eventSummary);
    const usageSummary = summarizePiMessageUsage(event);
    if (usageSummary) usage.push(usageSummary);
    if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      replyText += event.assistantMessageEvent.delta || "";
    }
  });

  await agent.prompt(request.message);
  const reply = normalizeWhitespacePreserveLines(replyText) || extractLatestAssistantText(agent.state?.messages);
  if (!reply) {
    throw new Error("Pi agent completed without an assistant reply.");
  }

  return {
    agentId: request.agentId,
    reply,
    toolEvents: [...toolEvents, ...toolState.toolResults],
    usage,
    taskEventStatus: toolState.taskEventStatus
  };
}

function createOpenRouterPiModel(config: RuntimeConfig) {
  return {
    id: config.openRouterModel,
    name: config.openRouterModel,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: config.openRouterBaseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 128000,
    maxTokens: config.openRouterMaxCompletionTokens
  };
}

function createOpenRouterHeaders(config: RuntimeConfig) {
  return {
    ...(config.openRouterSiteUrl ? { "HTTP-Referer": config.openRouterSiteUrl } : {}),
    ...(config.openRouterAppName ? { "X-Title": config.openRouterAppName } : {})
  };
}

function toPiMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && ["user", "assistant"].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: normalizeWhitespacePreserveLines(normalizeContent(item.content)),
      timestamp: Date.now()
    }))
    .filter((item) => item.content)
    .slice(-12);
}

function extractLatestAssistantText(messages: unknown) {
  const assistant = Array.isArray(messages)
    ? [...messages].reverse().find((item) => item?.role === "assistant")
    : undefined;
  return normalizeWhitespacePreserveLines(normalizeContent(assistant?.content));
}

function normalizeContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.input_text || "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function summarizePiEvent(event: any) {
  if (!event || typeof event !== "object") return undefined;
  if (event.type === "tool_execution_start") {
    return { type: event.type, toolName: event.toolName };
  }
  if (event.type === "tool_execution_end") {
    return { type: event.type, toolName: event.toolName, isError: Boolean(event.isError) };
  }
  if (["agent_start", "agent_end", "turn_start", "turn_end"].includes(event.type)) {
    return { type: event.type };
  }
  return undefined;
}

function summarizePiMessageUsage(event: any) {
  const message = event?.type === "message_end" ? event.message : undefined;
  if (message?.role !== "assistant") return undefined;
  const rawUsage = message.usage && typeof message.usage === "object" ? message.usage : {};
  const usage = {
    model: message.responseModel || message.model || "",
    input: normalizeNonNegativeNumber(rawUsage.input, 0),
    output: normalizeNonNegativeNumber(rawUsage.output, 0),
    cacheRead: normalizeNonNegativeNumber(rawUsage.cacheRead, 0),
    cacheWrite: normalizeNonNegativeNumber(rawUsage.cacheWrite, 0),
    totalTokens: normalizeNonNegativeNumber(rawUsage.totalTokens, 0),
    costUsd: normalizeNonNegativeNumber(rawUsage.cost?.total, 0)
  };
  if (!usage.totalTokens) usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return usage.totalTokens > 0 ? usage : undefined;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeWhitespacePreserveLines(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
