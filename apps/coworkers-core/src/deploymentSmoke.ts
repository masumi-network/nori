import crypto from "node:crypto";
import type { RuntimeConfig } from "./config.js";

export type DeploymentSmokeCheck = {
  id: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

export type DeploymentSmokeState = {
  enabled: boolean;
  status: "disabled" | "pending" | "passed" | "failed";
  startedAt?: string;
  completedAt?: string;
  checks: DeploymentSmokeCheck[];
};

type SmokeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type SmokeCase = {
  id: string;
  createBody: (marker: string) => Record<string, unknown>;
};

const SMOKE_CASES: SmokeCase[] = [
  {
    id: "live-model-assistant-history",
    createBody: (marker) => createRequestBody({
      marker,
      messages: [
        { role: "user", content: "Can Nori help with Masumi and Sokosumi development?" },
        { role: "assistant", content: "Yes. I can help with Masumi and Sokosumi development." }
      ]
    })
  }
];

export function createDeploymentSmokeState(enabled: boolean): DeploymentSmokeState {
  return {
    enabled,
    status: enabled ? "pending" : "disabled",
    checks: []
  };
}

export async function runDeploymentSmokeSuite({
  baseUrl,
  config,
  fetchImpl = fetch,
  nonce = crypto.randomBytes(10).toString("hex")
}: {
  baseUrl: string;
  config: RuntimeConfig;
  fetchImpl?: SmokeFetch;
  nonce?: string;
}): Promise<DeploymentSmokeState> {
  if (!config.deploymentSmokeTestEnabled) return createDeploymentSmokeState(false);

  const startedAt = new Date().toISOString();
  const checks = await Promise.all(
    SMOKE_CASES.map((smokeCase) => runSmokeCase({
      baseUrl,
      config,
      fetchImpl,
      marker: `nori-deploy-${nonce}-${smokeCase.id}`,
      smokeCase
    }))
  );

  return {
    enabled: true,
    status: checks.every((check) => check.ok) ? "passed" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    checks
  };
}

async function runSmokeCase({
  baseUrl,
  config,
  fetchImpl,
  marker,
  smokeCase
}: {
  baseUrl: string;
  config: RuntimeConfig;
  fetchImpl: SmokeFetch;
  marker: string;
  smokeCase: SmokeCase;
}): Promise<DeploymentSmokeCheck> {
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(new URL("/v1/chat", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": `deployment-smoke-${smokeCase.id}`,
        ...(config.coworkersApiKey ? { authorization: `Bearer ${config.coworkersApiKey}` } : {})
      },
      body: JSON.stringify(smokeCase.createBody(marker)),
      signal: AbortSignal.timeout(config.deploymentSmokeTimeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Nori returned HTTP ${response.status}.`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.agentId !== "nori") {
      throw new Error("Nori returned the wrong agent identity.");
    }
    if (typeof result.reply !== "string" || !result.reply.includes(marker)) {
      throw new Error("Nori's reply did not contain the unique deployment marker.");
    }
    if (!hasNonZeroModelUsage(result.usage)) {
      throw new Error("Nori returned no non-zero model token usage.");
    }

    return {
      id: smokeCase.id,
      ok: true,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      id: smokeCase.id,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function createRequestBody({
  marker,
  messages
}: {
  marker: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  return {
    agentId: "nori",
    surface: "docs",
    userId: "deployment-smoke",
    message: [
      "This is an automated deployment health check.",
      "Do not call tools.",
      `Reply with this exact token and nothing else: ${marker}`
    ].join(" "),
    metadata: {
      deploymentSmokeTest: true,
      ...(messages ? { messages } : {})
    }
  };
}

function hasNonZeroModelUsage(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object") return false;
    const usage = item as Record<string, unknown>;
    const totalTokens = Number(usage.totalTokens);
    return Number.isFinite(totalTokens) && totalTokens > 0;
  });
}
