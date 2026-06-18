import fs from "node:fs/promises";
import path from "node:path";
import type { CoworkerId, CoworkerSurface, PromptMode } from "./types.js";
import { AGENT_DISPLAY_NAME, promptModeForSurface } from "./types.js";

export type AgentPromptBundle = {
  agentId: CoworkerId;
  surface: CoworkerSurface;
  mode: PromptMode;
  systemPrompt: string;
  loadedFiles: string[];
};

export async function buildSystemPrompt({
  promptRoot,
  agentId,
  surface,
  mode = promptModeForSurface(surface)
}: {
  promptRoot: string;
  agentId: CoworkerId;
  surface: CoworkerSurface;
  mode?: PromptMode;
}): Promise<AgentPromptBundle> {
  const agentRoot = path.join(promptRoot, agentId);
  const sections: string[] = [];
  const loadedFiles: string[] = [];

  await addSection(sections, loadedFiles, "Agent Config", path.join(agentRoot, "agent.yaml"));
  await addSection(sections, loadedFiles, "Identity", path.join(agentRoot, "identity.md"));
  await addSection(sections, loadedFiles, "Soul", path.join(agentRoot, "soul.md"));
  await addSection(sections, loadedFiles, "Principles", path.join(agentRoot, "principles.md"));
  await addSection(sections, loadedFiles, "Expertise", path.join(agentRoot, "expertise.md"));
  await addSection(sections, loadedFiles, `${mode} Context`, path.join(agentRoot, "contexts", `${mode}.md`));
  await addSection(sections, loadedFiles, `${surface} Interface`, path.join(agentRoot, "interfaces", `${surface}.md`));
  await addMarkdownDirectory(sections, loadedFiles, "Knowledge", path.join(agentRoot, "knowledge"));

  if (!sections.length) {
    throw new Error(`No prompt files found for coworker ${agentId} at ${agentRoot}`);
  }

  sections.push([
    "## Runtime Contract",
    "",
    `You are running inside the independent Pi-agent runtime for ${AGENT_DISPLAY_NAME}.`,
    `Answer as ${AGENT_DISPLAY_NAME}. Keep the reply directly useful to the user.`,
    "Do not mention legacy runtime internals.",
    "Available Pi tools: set_task_event_status, request_user_input, log_observation, search_docs, complete_task, comment_on_task.",
    "Do not call or refer to any legacy tool names that are not in the available Pi tools list.",
    "log_observation records runtime-local observations in tool events and logs; search_docs searches local coworker prompts and runtime documentation.",
    "Use complete_task or set_task_event_status when you need to make the final Sokosumi task state explicit.",
    "When handling a Sokosumi task, finish with a clear task-board-ready response."
  ].join("\n"));

  return {
    agentId,
    surface,
    mode,
    systemPrompt: sections.join("\n\n---\n\n"),
    loadedFiles
  };
}

async function addSection(sections: string[], loadedFiles: string[], title: string, filePath: string) {
  const content = await readOptionalFile(filePath);
  if (!content) return;
  sections.push(`## ${title}\n\n${content}`);
  loadedFiles.push(filePath);
}

async function addMarkdownDirectory(sections: string[], loadedFiles: string[], title: string, directoryPath: string) {
  const entries = await readOptionalDirectory(directoryPath);
  if (!entries.length) return;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    await addSection(sections, loadedFiles, `${title}: ${path.basename(entry.name, ".md")}`, path.join(directoryPath, entry.name));
  }
}

async function readOptionalFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.trim();
  } catch (error: any) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function readOptionalDirectory(directoryPath: string) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
