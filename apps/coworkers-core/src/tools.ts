// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { CoworkerRequest } from "./types.js";

export type RuntimeToolState = {
  taskEventStatus?: {
    status: "COMPLETED" | "INPUT_REQUIRED" | "FAILED";
    reason?: string;
  };
  toolResults: unknown[];
};

export const RUNTIME_TOOL_NAMES = [
  "set_task_event_status",
  "request_user_input",
  "log_observation",
  "search_docs",
  "complete_task",
  "comment_on_task"
] as const;

export function createCoworkerRuntimeTools(request: CoworkerRequest, state: RuntimeToolState) {
  return [
    {
      name: "set_task_event_status",
      label: "Set Task Event Status",
      description: "For Sokosumi task handling, choose whether the task-board reply is COMPLETED, INPUT_REQUIRED, or FAILED.",
      parameters: Type.Object({
        status: Type.Union([Type.Literal("COMPLETED"), Type.Literal("INPUT_REQUIRED"), Type.Literal("FAILED")]),
        reason: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId: string, params: any) => {
        state.taskEventStatus = {
          status: params.status,
          reason: params.reason || ""
        };
        return recordTool(state, {
          tool: "set_task_event_status",
          ok: true,
          data: state.taskEventStatus,
          userMessage: `Task status set to ${params.status}.`
        });
      }
    },
    {
      name: "request_user_input",
      label: "Request User Input",
      description: "Mark the current task as requiring more user input. Use only when the work cannot continue without clarification.",
      parameters: Type.Object({
        question: Type.String(),
        reason: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId: string, params: any) => {
        state.taskEventStatus = {
          status: "INPUT_REQUIRED",
          reason: params.reason || params.question || ""
        };
        return recordTool(state, {
          tool: "request_user_input",
          ok: true,
          data: state.taskEventStatus,
          userMessage: `Input required: ${params.question}`
        });
      }
    },
    {
      name: "log_observation",
      label: "Log Observation",
      description: "Record a structured runtime observation for this agent turn. The observation is included in tool events and runtime logs.",
      parameters: Type.Object({
        observation: Type.String(),
        category: Type.Optional(Type.String()),
        importance: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId: string, params: any) => {
        const observation = {
          agentId: request.agentId,
          surface: request.surface,
          userId: request.userId,
          observation: normalizeText(params.observation),
          category: normalizeText(params.category) || "general",
          importance: normalizeText(params.importance) || "normal",
          createdAt: new Date().toISOString()
        };
        console.log(JSON.stringify({ event: "coworker_observation_logged", ...observation }));
        return recordTool(state, {
          tool: "log_observation",
          ok: true,
          effect: "runtime_log",
          data: observation,
          userMessage: "Observation logged for this runtime turn."
        });
      }
    },
    {
      name: "search_docs",
      label: "Search Docs",
      description: "Search local coworker prompts, knowledge files, and runtime documentation for relevant context.",
      parameters: Type.Object({
        query: Type.String()
      }),
      execute: async (_toolCallId: string, params: any) => {
        const query = normalizeText(params.query);
        const results = query ? await searchLocalDocs(query) : [];
        return recordTool(state, {
          tool: "search_docs",
          ok: true,
          effect: "read",
          data: { query, results },
          userMessage: formatSearchResults(query, results)
        });
      }
    },
    {
      name: "complete_task",
      label: "Complete Task",
      description: "Mark the current task as completed. Use after preparing the final answer.",
      parameters: Type.Object({
        summary: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId: string, params: any) => {
        state.taskEventStatus = {
          status: "COMPLETED",
          reason: normalizeText(params.summary)
        };
        return recordTool(state, {
          tool: "complete_task",
          ok: true,
          effect: "task_status",
          data: state.taskEventStatus,
          userMessage: "Task marked completed."
        });
      }
    },
    {
      name: "comment_on_task",
      label: "Comment On Task",
      description: "Record the task-board comment that should be reflected in the final response.",
      parameters: Type.Object({
        comment: Type.String()
      }),
      execute: async (_toolCallId: string, params: any) => recordTool(state, {
        tool: "comment_on_task",
        ok: true,
        effect: "task_comment",
        data: {
          comment: normalizeText(params.comment),
          agentId: request.agentId,
          surface: request.surface
        },
        userMessage: normalizeText(params.comment) || "Task comment recorded."
      })
    }
  ];
}

function recordTool(state: RuntimeToolState, result: any) {
  state.toolResults.push(result);
  return {
    content: [{ type: "text", text: result.userMessage || JSON.stringify(result.data || { ok: result.ok }) }],
    details: result
  };
}

async function searchLocalDocs(query: string) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const root = await resolveSearchRoot(process.cwd());
  const files = await collectSearchFiles(root);
  const matches = [];
  for (const filePath of files) {
    const content = await readSearchFile(filePath);
    if (!content) continue;
    const score = scoreContent(content, query, tokens);
    if (score <= 0) continue;
    matches.push({
      path: path.relative(root, filePath),
      score,
      snippet: createSnippet(content, query, tokens)
    });
  }

  return matches
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 5);
}

async function resolveSearchRoot(startPath: string) {
  let current = startPath;
  for (let depth = 0; depth < 6; depth += 1) {
    if (await statOptional(path.join(current, "src", "agents"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startPath;
}

async function collectSearchFiles(root: string) {
  const candidates = [
    path.join(root, "README.md"),
    path.join(root, "CLAUDE.md"),
    path.join(root, "src", "agents")
  ];
  const files = [];
  for (const candidate of candidates) {
    const stat = await statOptional(candidate);
    if (!stat) continue;
    if (stat.isFile() && isSearchableFile(candidate)) files.push(candidate);
    if (stat.isDirectory()) files.push(...await walkSearchDirectory(candidate));
  }
  return files;
}

async function walkSearchDirectory(directoryPath: string) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkSearchDirectory(entryPath));
    } else if (entry.isFile() && isSearchableFile(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function isSearchableFile(filePath: string) {
  return [".md", ".yaml", ".yml", ".json", ".txt"].includes(path.extname(filePath).toLowerCase());
}

async function statOptional(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readSearchFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.slice(0, 200000);
  } catch {
    return "";
  }
}

function scoreContent(content: string, query: string, tokens: string[]) {
  const normalized = content.toLowerCase();
  let score = normalized.includes(query.toLowerCase()) ? 10 : 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score += 1;
  }
  return score;
}

function createSnippet(content: string, query: string, tokens: string[]) {
  const normalized = content.toLowerCase();
  const queryIndex = normalized.indexOf(query.toLowerCase());
  const tokenIndex = tokens
    .map((token) => normalized.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const index = queryIndex >= 0 ? queryIndex : tokenIndex || 0;
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + 280);
  return normalizeText(content.slice(start, end)).replace(/\s+/g, " ");
}

function formatSearchResults(query: string, results: any[]) {
  if (!query) return "No search query provided.";
  if (!results.length) return `No local documentation matches found for "${query}".`;
  return [
    `Found ${results.length} local documentation match${results.length === 1 ? "" : "es"} for "${query}":`,
    ...results.map((result) => `- ${result.path}: ${result.snippet}`)
  ].join("\n");
}

function tokenize(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9_-]+/g)
    .filter((token) => token.length >= 3);
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}
