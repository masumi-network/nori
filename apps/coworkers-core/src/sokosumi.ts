// @ts-nocheck
import { startSokosumiAgentWorker } from "@masumi-network/pi-sokosumi/worker";
import type { RuntimeConfig } from "./config.js";
import type { CoworkerAgentRunner } from "./dispatch.js";
import { dispatchCoworkerRequest } from "./dispatch.js";
import type { CoworkerId, CoworkerRequest } from "./types.js";
import { AGENT_ID, normalizeCoworkerId } from "./types.js";

export function startCoworkerSokosumiWorker({
  config,
  runner
}: {
  config: RuntimeConfig;
  runner?: CoworkerAgentRunner;
}) {
  if (!config.sokosumiTaskPollerEnabled) {
    console.log(JSON.stringify({ event: "sokosumi_worker_disabled" }));
    return undefined;
  }

  const mockMode = !config.sokosumiCoworkerApiKey;
  const client = mockMode ? createMockSokosumiCoworkerClient() : undefined;
  if (mockMode) {
    console.log(JSON.stringify({ event: "sokosumi_worker_mock_mode" }));
  }

  return startSokosumiAgentWorker({
    enabled: true,
    apiUrl: config.sokosumiApiUrl,
    apiKey: config.sokosumiCoworkerApiKey,
    client,
    intervalMs: config.sokosumiTaskPollIntervalMs,
    limit: config.sokosumiTaskPollLimit,
    maxPages: config.sokosumiTaskPollMaxPages,
    logger: console,
    runningComment: "The coworker picked up this task.",
    canceledComment: "The coworker canceled this task as requested.",
    createTaskHandler: async ({ task, event }) => {
      const request = createSokosumiTaskRequest({ task, event });
      const result = await dispatchCoworkerRequest(request, config, runner);
      return createSokosumiCompletionEvent(result);
    }
  });
}

export function createSokosumiCompletionEvent(result) {
  const status = result.taskEventStatus?.status || "COMPLETED";
  return {
    status,
    origin: "SOKOSUMI",
    comment: result.reply,
    ...(status === "COMPLETED" ? { credits: 0 } : {}),
    metadata: {
      agentId: result.agentId,
      usage: result.usage || [],
      toolEvents: result.toolEvents || [],
      reason: result.taskEventStatus?.reason || ""
    }
  };
}

export function createSokosumiTaskRequest({ task = {}, event = {} } = {}): CoworkerRequest {
  const metadata = mergeMetadata(task, event);
  const agentId = resolveSokosumiAgentId(task, event, metadata) || AGENT_ID;
  return {
    agentId,
    surface: "sokosumi",
    userId: firstString(
      metadata.userId,
      metadata.ownerUserId,
      metadata.delegationUserId,
      task.userId,
      task.ownerUserId,
      "sokosumi"
    ),
    organizationId: firstString(metadata.organizationId, metadata.workspaceId, task.organizationId, task.workspaceId),
    message: createTaskMessage(task, event),
    attachments: Array.isArray(task.attachments) ? task.attachments : undefined,
    metadata: {
      ...metadata,
      taskId: task.id,
      eventId: event.id,
      taskStatus: task.status,
      eventStatus: event.status
    }
  };
}

export function createMockSokosumiCoworkerClient(seedTasks = []) {
  const tasks = new Map();
  const events = [];
  const createdEvents = [];

  for (const task of seedTasks) {
    const normalized = normalizeTask(task);
    tasks.set(normalized.id, normalized);
    events.push({
      id: `evt_${normalized.id}`,
      taskId: normalized.id,
      status: "READY",
      comment: normalized.description || normalized.title,
      createdAt: new Date().toISOString()
    });
  }

  return {
    createdEvents,
    async listCoworkerEvents({ limit = 20 } = {}) {
      return {
        events: events.slice(0, limit),
        pagination: {}
      };
    },
    async createTask(input) {
      const task = normalizeTask({
        id: createId("tsk"),
        title: input.title,
        description: input.description,
        status: input.status || "draft",
        metadata: input.metadata || {}
      });
      tasks.set(task.id, task);
      return task;
    },
    async getTask(taskId) {
      return tasks.get(taskId);
    },
    async updateTask(input) {
      const task = tasks.get(input.taskId);
      if (!task) throw new Error(`Sokosumi task not found: ${input.taskId}`);
      const updated = normalizeTask({
        ...task,
        ...input,
        id: task.id,
        metadata: { ...(task.metadata || {}), ...(input.metadata || {}) }
      });
      tasks.set(updated.id, updated);
      return updated;
    },
    async commentOnTask(input) {
      const task = tasks.get(input.taskId);
      if (!task) throw new Error(`Sokosumi task not found: ${input.taskId}`);
      task.comments.push({ id: createId("cmt"), body: input.body, createdAt: new Date().toISOString() });
      return task;
    },
    async createTaskEvent(taskId, body) {
      const event = {
        id: createId("evt"),
        taskId,
        ...body,
        createdAt: new Date().toISOString()
      };
      createdEvents.push(event);
      const task = tasks.get(taskId);
      if (task) {
        task.events = [...(task.events || []), event];
        if (body.status) task.status = body.status;
      }
      return event;
    }
  };
}

function resolveSokosumiAgentId(task: any, event: any, metadata: Record<string, any>): CoworkerId | undefined {
  return normalizeCoworkerId(
    metadata.agentId ||
    metadata.agent_id ||
    metadata.coworker ||
    metadata.coworkerId ||
    metadata.coworkerSlug ||
    event.agentId ||
    event.agent_id ||
    event.coworker ||
    task.agentId ||
    task.agent_id ||
    task.coworker ||
    AGENT_ID
  );
}

function createTaskMessage(task: any, event: any) {
  return [
    event.comment,
    event.message,
    event.body,
    task.description,
    task.body,
    task.content,
    task.title,
    task.name
  ].filter(Boolean).join("\n\n").trim();
}

function mergeMetadata(task: any, event: any) {
  return {
    ...(task?.metadata && typeof task.metadata === "object" ? task.metadata : {}),
    ...(event?.metadata && typeof event.metadata === "object" ? event.metadata : {})
  };
}

function normalizeTask(task: any) {
  const now = new Date().toISOString();
  return {
    id: task.id || createId("tsk"),
    title: task.title || task.name || "Untitled Sokosumi task",
    description: task.description || "",
    status: task.status || "draft",
    comments: Array.isArray(task.comments) ? task.comments : [],
    events: Array.isArray(task.events) ? task.events : [],
    metadata: task.metadata || {},
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
