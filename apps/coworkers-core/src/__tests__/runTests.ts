import assert from "node:assert/strict";
import path from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { runPiCoworkerAgent, toPiMessages } from "../agentRunner.js";
import { loadConfig } from "../config.js";
import { runDeploymentSmokeSuite } from "../deploymentSmoke.js";
import { dispatchCoworkerRequest } from "../dispatch.js";
import { getRuntimeReadiness } from "../readiness.js";
import { normalizeChatRequest, normalizeWebhookRequest } from "../normalization.js";
import { buildSystemPrompt } from "../prompts.js";
import { createSokosumiCompletionEvent, createSokosumiTaskRequest } from "../sokosumi.js";
import { createCoworkerRuntimeTools, RUNTIME_TOOL_NAMES } from "../tools.js";
import { createSokosumiTaskPoller } from "@masumi-network/pi-sokosumi/poller";

const config = loadConfig({
  ...process.env,
  COWORKER_PROMPT_ROOT: path.resolve(process.cwd(), "..", "..", "src", "agents"),
  PI_AGENT_MOCK_RESPONSES: "true"
});

await testPromptLoading();
await testWebhookNormalization();
await testDocsSurfaceNormalization();
await testDispatch();
await testAssistantHistoryConversion();
await testAssistantHistoryAgentRun();
await testUnderlyingProviderError();
await testDeploymentSmokeSuite();
await testSokosumiTaskMapping();
await testSokosumiTaskDefaultsToAgent();
await testRuntimeTools();
await testReadiness();
await testCompletedEventsIncludeCredits();
await testPollerTreatsDelegatedUserCommentAsInput();

console.log("nori tests passed");

async function testPromptLoading() {
  const noriPrompt = await buildSystemPrompt({
    promptRoot: config.promptRoot,
    agentId: "nori",
    surface: "telegram"
  });
  assert.equal(noriPrompt.agentId, "nori");
  assert.equal(noriPrompt.surface, "telegram");
  assert.match(noriPrompt.systemPrompt, /Nori/i);
  assert.ok(noriPrompt.loadedFiles.some((file) => file.endsWith("identity.md")));

  const sokosumiPrompt = await buildSystemPrompt({
    promptRoot: config.promptRoot,
    agentId: "nori",
    surface: "sokosumi"
  });
  assert.match(sokosumiPrompt.systemPrompt, /Nori/i);
  assert.match(sokosumiPrompt.systemPrompt, /set_task_event_status/);
  assert.ok(sokosumiPrompt.loadedFiles.some((file) => file.endsWith("interfaces/sokosumi.md")));
}

async function testWebhookNormalization() {
  const request = normalizeWebhookRequest({
    agentId: "nori",
    surface: "email",
    headers: {
      "x-user-id": "user-1"
    },
    body: {
      email: {
        body: "Can you check this?"
      },
      authorization: "secret",
      metadata: {
        organizationId: "org-1"
      }
    }
  });

  assert.equal(request.agentId, "nori");
  assert.equal(request.surface, "email");
  assert.equal(request.userId, "user-1");
  assert.equal(request.organizationId, "org-1");
  assert.equal(request.message, "Can you check this?");
  assert.equal((request.metadata?.sourcePayload as any).authorization, "[redacted]");
}

async function testDocsSurfaceNormalization() {
  const request = normalizeChatRequest({
    agentId: "nori",
    surface: "docs",
    message: "How do I create a Sokosumi coworker?"
  });

  assert.equal(request.agentId, "nori");
  assert.equal(request.surface, "docs");
  assert.equal(request.message, "How do I create a Sokosumi coworker?");
}

async function testDispatch() {
  const result = await dispatchCoworkerRequest(
    {
      agentId: "nori",
      surface: "telegram",
      userId: "user-2",
      message: "Explain how Sokosumi coworker registration works."
    },
    config,
    async ({ request, systemPrompt }) => ({
      agentId: request.agentId,
      reply: `${request.agentId}:${systemPrompt.includes("Nori")}`
    })
  );

  assert.equal(result.agentId, "nori");
  assert.equal(result.reply, "nori:true");
}

async function testAssistantHistoryConversion() {
  const messages = toPiMessages([
    { role: "user", content: "What does Nori do?", timestamp: 100 },
    { role: "assistant", content: [{ type: "text", text: "I help developers." }], timestamp: 200 },
    { role: "system", content: "Ignore this unsupported role." },
    { role: "assistant", content: "   " }
  ], {
    id: "test-model",
    api: "openai-completions",
    provider: "openrouter"
  }, 300);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    role: "user",
    content: [{ type: "text", text: "What does Nori do?" }],
    timestamp: 100
  });
  assert.deepEqual(messages[1], {
    role: "assistant",
    content: [{ type: "text", text: "I help developers." }],
    api: "openai-completions",
    provider: "openrouter",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason: "stop",
    timestamp: 200
  });
}

async function testAssistantHistoryAgentRun() {
  let providerMessages: any[] = [];
  const result = await runPiCoworkerAgent({
    request: {
      agentId: "nori",
      surface: "docs",
      userId: "history-test",
      message: "What should I do next?",
      metadata: {
        messages: [
          { role: "user", content: "Can you help me?" },
          { role: "assistant", content: "Yes, I can help." }
        ]
      }
    },
    systemPrompt: "You are Nori.",
    config: createModelTestConfig(),
    streamFn: (_model, context) => {
      providerMessages = context.messages;
      return createFinishedStream(createAssistantMessage("Assistant history works."));
    }
  });

  assert.equal(result.reply, "Assistant history works.");
  const replayedAssistant = providerMessages.find((message) => message.role === "assistant");
  assert.ok(replayedAssistant);
  assert.equal(replayedAssistant.api, "openai-completions");
  assert.equal(replayedAssistant.provider, "openrouter");
  assert.deepEqual(replayedAssistant.content, [{ type: "text", text: "Yes, I can help." }]);
}

async function testUnderlyingProviderError() {
  await assert.rejects(
    runPiCoworkerAgent({
      request: {
        agentId: "nori",
        surface: "docs",
        userId: "error-test",
        message: "Trigger the fake provider error."
      },
      systemPrompt: "You are Nori.",
      config: createModelTestConfig(),
      streamFn: () => createFinishedStream(createAssistantMessage("partial output", {
        stopReason: "error",
        errorMessage: "synthetic provider outage"
      }))
    }),
    /Pi agent failed before producing a complete reply: synthetic provider outage/
  );
}

async function testDeploymentSmokeSuite() {
  const requests: any[] = [];
  const smokeConfig = loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "smoke-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    PI_AGENT_MOCK_RESPONSES: "false",
    NORI_DEPLOYMENT_SMOKE_TEST_ENABLED: "true",
    NORI_DEPLOYMENT_SMOKE_TIMEOUT_MS: "1000"
  });
  const result = await runDeploymentSmokeSuite({
    baseUrl: "http://127.0.0.1:3000",
    config: smokeConfig,
    nonce: "fixed",
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const marker = String(request.message).split(": ").at(-1);
      return new Response(JSON.stringify({
        agentId: "nori",
        reply: marker,
        usage: [{ totalTokens: 5 }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.status, "passed");
  assert.equal(result.checks.length, 1);
  assert.ok(result.checks.every((check) => check.ok));
  assert.ok(requests.some((request) =>
    request.metadata?.messages?.some((message: any) => message.role === "assistant")
  ));

  const failed = await runDeploymentSmokeSuite({
    baseUrl: "http://127.0.0.1:3000",
    config: smokeConfig,
    nonce: "fixed",
    fetchImpl: async () => new Response(JSON.stringify({
      agentId: "nori",
      reply: "not the requested marker",
      usage: []
    }), { status: 200 })
  });
  assert.equal(failed.status, "failed");
  assert.ok(failed.checks.every((check) => !check.ok));

  const railwayDefault = loadConfig({ RAILWAY_ENVIRONMENT_ID: "test-environment" });
  assert.equal(railwayDefault.deploymentSmokeTestEnabled, true);
  const localDefault = loadConfig({});
  assert.equal(localDefault.deploymentSmokeTestEnabled, false);
}

async function testSokosumiTaskMapping() {
  const request = createSokosumiTaskRequest({
    task: {
      id: "task-1",
      title: "Edit product video",
      description: "Create short-form edits.",
      metadata: {
        userId: "user-3"
      }
    },
    event: {
      id: "event-1",
      status: "READY",
      comment: "Please handle this for TikTok."
    }
  });

  assert.equal(request.agentId, "nori");
  assert.equal(request.surface, "sokosumi");
  assert.equal(request.userId, "user-3");
  assert.match(request.message, /TikTok/);
}

async function testSokosumiTaskDefaultsToAgent() {
  const request = createSokosumiTaskRequest({
    task: {
      id: "task-2",
      title: "Ambiguous task",
      description: "No coworker metadata."
    },
    event: {
      id: "event-2",
      status: "READY"
    }
  });
  assert.equal(request.agentId, "nori");
}

async function testRuntimeTools() {
  const state: any = { toolResults: [] };
  const tools = createCoworkerRuntimeTools({
    agentId: "nori",
    surface: "sokosumi",
    userId: "user-4",
    message: "test"
  }, state);
  assert.deepEqual(tools.map((tool: any) => tool.name), [...RUNTIME_TOOL_NAMES]);

  const byName = Object.fromEntries(tools.map((tool: any) => [tool.name, tool]));
  const searchResult = await byName.search_docs.execute("search-1", { query: "Nori" });
  assert.equal(searchResult.details.ok, true);
  assert.ok(searchResult.details.data.results.some((result: any) => result.path.includes("src/agents/nori")));

  const coworkerSearchResult = await byName.search_docs.execute("search-2", {
    query: "create a Sokosumi coworker with Pi Sokosumi"
  });
  assert.equal(coworkerSearchResult.details.ok, true);
  assert.ok(
    coworkerSearchResult.details.data.results.some((result: any) =>
      result.path.includes("src/agents/nori/knowledge/devhub-docs.md")
    )
  );

  const observationResult = await byName.log_observation.execute("obs-1", {
    observation: "User cares about Sokosumi Pi migration status.",
    category: "preference"
  });
  assert.equal(observationResult.details.effect, "runtime_log");

  await byName.complete_task.execute("complete-1", { summary: "Done." });
  assert.equal(state.taskEventStatus.status, "COMPLETED");
}

async function testReadiness() {
  const readyConfig = loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "test-key",
    OPENROUTER_API_KEY: "test-openrouter-key"
  });
  const readiness = getRuntimeReadiness(readyConfig);
  assert.equal(readiness.ok, true);

  const missingSokosumiKeyConfig = loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "test-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    SOKOSUMI_TASK_POLLER_ENABLED: "true",
    SOKOSUMI_COWORKER_API_KEY: ""
  });
  const missingSokosumiKeyReadiness = getRuntimeReadiness(missingSokosumiKeyConfig);
  assert.equal(missingSokosumiKeyReadiness.ok, false);
  assert.equal(missingSokosumiKeyReadiness.checks.sokosumiPollingConfigured, false);
}

async function testCompletedEventsIncludeCredits() {
  const event = createSokosumiCompletionEvent({
    agentId: "nori",
    reply: "done"
  });
  assert.equal(event.status, "COMPLETED");
  assert.equal(event.credits, 0);
}

async function testPollerTreatsDelegatedUserCommentAsInput() {
  const createdEvents: any[] = [];
  const triggerEvent = {
    id: "evt-user-input",
    taskId: "task-input",
    userId: "user-1",
    origin: "USER",
    comment: "Here is the missing detail.",
    createdAt: "2026-01-01T00:01:00.000Z"
  };
  const task = {
    id: "task-input",
    status: "in_progress",
    events: [
      {
        id: "evt-input-required",
        taskId: "task-input",
        coworkerId: "nori",
        status: "INPUT_REQUIRED",
        comment: "Need details.",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      triggerEvent
    ]
  };

  const poller = createSokosumiTaskPoller({
    client: {
      async listCoworkerEvents() {
        return { events: [triggerEvent], pagination: {} };
      },
      async getTask() {
        return task;
      },
      async createTaskEvent(_taskId: string, body: any) {
        createdEvents.push(body);
        return { id: `created-${createdEvents.length}`, ...body };
      }
    },
    createCompletedEvent: () => ({
      status: "COMPLETED",
      origin: "SOKOSUMI",
      comment: "Processed the new input.",
      credits: 0
    }),
    createRunningEvent: null
  } as any);

  await poller.tick();
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].comment, "Processed the new input.");
}

function createModelTestConfig() {
  return loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "test-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENROUTER_MODEL: "test-model",
    PI_AGENT_MOCK_RESPONSES: "false",
    NORI_DEPLOYMENT_SMOKE_TEST_ENABLED: "false"
  });
}

function createAssistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "openrouter",
    model: "test-model",
    usage: {
      input: 2,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 4,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides
  };
}

function createFinishedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({ type: "error", reason: message.stopReason, error: message });
    } else {
      stream.push({ type: "done", reason: message.stopReason, message });
    }
    stream.end(message);
  });
  return stream;
}
