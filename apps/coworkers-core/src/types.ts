export const AGENT_ID = "nori" as const;
export const AGENT_DISPLAY_NAME = "Nori";
export const AGENT_DESCRIPTION = "Masumi/Sokosumi/Kodosumi DevRel";

export const COWORKER_IDS = [AGENT_ID] as const;
export type CoworkerId = typeof COWORKER_IDS[number];

export const COWORKER_SURFACES = {
  nori: ["email", "telegram", "discord", "github", "twitter", "sokosumi", "chat"]
} as const;

export type CoworkerSurface = typeof COWORKER_SURFACES[CoworkerId][number];
export type PromptMode = "triage" | "execution";

export type CoworkerRequest = {
  agentId: CoworkerId;
  surface: CoworkerSurface;
  userId: string;
  organizationId?: string;
  message: string;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
};

export type CoworkerResult = {
  agentId: CoworkerId;
  reply: string;
  toolEvents?: unknown[];
  usage?: unknown[];
  taskEventStatus?: {
    status: "COMPLETED" | "INPUT_REQUIRED" | "FAILED";
    reason?: string;
  };
};

export class CoworkerRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "CoworkerRequestError";
    this.statusCode = statusCode;
  }
}

export function isCoworkerId(value: unknown): value is CoworkerId {
  return COWORKER_IDS.includes(String(value || "").toLowerCase() as CoworkerId);
}

export function normalizeCoworkerId(value: unknown): CoworkerId | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  return isCoworkerId(normalized) ? normalized : undefined;
}

export function isSupportedSurface(agentId: CoworkerId, surface: unknown): surface is CoworkerSurface {
  return (COWORKER_SURFACES[agentId] as readonly string[]).includes(String(surface || "").toLowerCase());
}

export function normalizeSurface(agentId: CoworkerId, surface: unknown): CoworkerSurface | undefined {
  const normalized = String(surface || "").trim().toLowerCase();
  return isSupportedSurface(agentId, normalized) ? normalized as CoworkerSurface : undefined;
}

export function promptModeForSurface(surface: CoworkerSurface): PromptMode {
  return surface === "github" || surface === "twitter" || surface === "email" || surface === "sokosumi"
    ? "execution"
    : "triage";
}
