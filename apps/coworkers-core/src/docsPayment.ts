import { randomBytes, randomUUID } from "node:crypto";
import {
  canonicalJson,
  createSokosumiMasumiPaymentPayload,
  normalizeMasumiApiUrl,
  sha256Hex
} from "@masumi-network/pi-sokosumi/masumi";
import type { RuntimeConfig } from "./config.js";
import type { CoworkerRequest, CoworkerResult } from "./types.js";

type PaymentFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CreateNoriDocsPaymentOptions = {
  fetchImpl?: PaymentFetch;
  now?: () => Date;
  randomIdentifier?: () => string;
  taskId?: string;
  eventId?: string;
};

const PAY_BY_OFFSET_MS = 16 * 60 * 60 * 1000;
const SUBMIT_RESULT_OFFSET_MS = 17 * 60 * 60 * 1000;

export class NoriDocsPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoriDocsPaymentError";
  }
}

export function isNoriDocsPaymentConfigured(config: RuntimeConfig) {
  return Boolean(
    isHttpUrl(config.masumiPaymentApiUrl) &&
    config.masumiPaymentApiToken.trim() &&
    /^[0-9a-f]{57,250}$/i.test(config.masumiAgentIdentifier)
  );
}

export async function maybeCreateNoriDocsPayment({
  request,
  reply,
  config,
  options = {}
}: {
  request: CoworkerRequest;
  reply: string;
  config: RuntimeConfig;
  options?: CreateNoriDocsPaymentOptions;
}): Promise<CoworkerResult["paymentEvent"] | undefined> {
  if (!shouldCreateNoriDocsPayment(request, config)) return undefined;
  if (!isNoriDocsPaymentConfigured(config)) {
    throw new NoriDocsPaymentError(
      "Nori docs payments are enabled but MASUMI_PAYMENT_API_URL, " +
      "MASUMI_PAYMENT_API_TOKEN (or MASUMI_PAYMENT_API_KEY), and " +
      "a valid hexadecimal MASUMI_AGENT_IDENTIFIER are required."
    );
  }

  const taskId = options.taskId || `task_nori_docs_${randomUUID()}`;
  const eventId = options.eventId || `evt_nori_docs_${randomUUID()}`;
  const inputHash = createNoriDocsInputHash(request);
  const resultHash = sha256Hex(reply);
  const identifierFromPurchaser = resolvePurchaserIdentifier(
    request,
    options.randomIdentifier || (() => randomBytes(8).toString("hex"))
  );
  const currentTime = (options.now || (() => new Date()))();
  const body = {
    agentIdentifier: config.masumiAgentIdentifier,
    network: config.masumiNetwork,
    inputHash,
    payByTime: new Date(currentTime.getTime() + PAY_BY_OFFSET_MS).toISOString(),
    submitResultTime: new Date(currentTime.getTime() + SUBMIT_RESULT_OFFSET_MS).toISOString(),
    identifierFromPurchaser,
    metadata: JSON.stringify({
      source: "masumi-dev-portal",
      taskId,
      eventId,
      surface: request.surface,
      inputHash,
      resultHash
    })
  };

  // Nori is registered with fixed pricing. The payment service rejects
  // RequestedFunds for fixed-price agents and resolves the advertised price
  // from the on-chain registry entry.
  const payment = await createFixedPricePayment(config, body, options.fetchImpl || fetch);
  const masumiPayment = createSokosumiMasumiPaymentPayload({
    ...payment,
    requestBody: body
  }) as Record<string, unknown>;
  validateNoriDocsPaymentPayload(masumiPayment, {
    agentIdentifier: config.masumiAgentIdentifier,
    network: config.masumiNetwork,
    inputHash,
    identifierFromPurchaser
  });

  console.log(JSON.stringify({
    event: "nori_docs_payment_created",
    taskId,
    eventId,
    paymentId: textValue(masumiPayment.id),
    blockchainIdentifier: textValue(masumiPayment.blockchainIdentifier),
    network: config.masumiNetwork
  }));

  return {
    taskId,
    eventId,
    resultHash,
    masumiPayment
  };
}

export function createNoriDocsInputHash(request: CoworkerRequest) {
  return sha256Hex(canonicalJson({
    agentId: request.agentId,
    surface: request.surface,
    message: request.message,
    attachments: request.attachments || []
  }));
}

export function validateNoriDocsPaymentPayload(
  payment: Record<string, unknown>,
  expected?: {
    agentIdentifier?: string;
    network?: string;
    inputHash?: string;
    identifierFromPurchaser?: string;
  }
) {
  const paymentSource = objectValue(payment.PaymentSource);
  const requiredFields: Array<[string, unknown]> = [
    ["blockchainIdentifier", payment.blockchainIdentifier],
    ["agentIdentifier", payment.agentIdentifier],
    ["sellerVkey", payment.sellerVkey],
    ["inputHash", payment.inputHash],
    ["identifierFromPurchaser", payment.identifierFromPurchaser],
    ["payByTime", payment.payByTime],
    ["submitResultTime", payment.submitResultTime],
    ["unlockTime", payment.unlockTime],
    ["externalDisputeUnlockTime", payment.externalDisputeUnlockTime],
    ["PaymentSource.network", paymentSource.network],
    ["PaymentSource.smartContractAddress", paymentSource.smartContractAddress]
  ];
  const missing = requiredFields
    .filter(([, value]) => !textValue(value))
    .map(([field]) => field);
  if (missing.length) {
    throw new NoriDocsPaymentError(
      `Masumi payment response is missing required fields: ${missing.join(", ")}.`
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(textValue(payment.inputHash))) {
    throw new NoriDocsPaymentError("Masumi payment response contains an invalid inputHash.");
  }
  if (expected?.agentIdentifier && textValue(payment.agentIdentifier) !== expected.agentIdentifier) {
    throw new NoriDocsPaymentError("Masumi payment response returned the wrong agentIdentifier.");
  }
  if (expected?.network && textValue(paymentSource.network) !== expected.network) {
    throw new NoriDocsPaymentError("Masumi payment response returned the wrong network.");
  }
  if (expected?.inputHash && textValue(payment.inputHash) !== expected.inputHash) {
    throw new NoriDocsPaymentError("Masumi payment response returned the wrong inputHash.");
  }
  if (
    expected?.identifierFromPurchaser &&
    textValue(payment.identifierFromPurchaser) !== expected.identifierFromPurchaser
  ) {
    throw new NoriDocsPaymentError(
      "Masumi payment response returned the wrong identifierFromPurchaser."
    );
  }
  return payment;
}

function shouldCreateNoriDocsPayment(request: CoworkerRequest, config: RuntimeConfig) {
  return config.noriDocsPaymentEnabled && request.surface === "docs";
}

async function createFixedPricePayment(
  config: RuntimeConfig,
  body: Record<string, unknown>,
  fetchImpl: PaymentFetch
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.masumiPaymentTimeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(
      `${normalizeMasumiApiUrl(config.masumiPaymentApiUrl)}/payment`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          token: config.masumiPaymentApiToken
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new NoriDocsPaymentError(
        `Masumi payment request timed out after ${config.masumiPaymentTimeoutMs}ms.`
      );
    }
    throw new NoriDocsPaymentError(
      `Masumi payment request failed: ${error?.message || String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parsePaymentResponse(response);
  if (!response.ok || (payload?.status && payload.status !== "success")) {
    const detail = errorMessage(payload) || `HTTP ${response.status}`;
    throw new NoriDocsPaymentError(`Masumi payment creation failed: ${detail}`);
  }

  const data = payload?.data ?? payload;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new NoriDocsPaymentError("Masumi payment creation returned an invalid response.");
  }
  return data as Record<string, unknown>;
}

async function parsePaymentResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function errorMessage(payload: any) {
  const value = payload?.error?.message || payload?.message || payload?.error || payload?.raw;
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function resolvePurchaserIdentifier(
  request: CoworkerRequest,
  createFallback: () => string
) {
  const sourcePayload = objectValue(request.metadata?.sourcePayload);
  const sourceMetadata = objectValue(sourcePayload.metadata);
  const explicit = textValue(
    request.metadata?.identifierFromPurchaser ||
    sourceMetadata.identifierFromPurchaser ||
    sourcePayload.identifierFromPurchaser
  );
  const value = explicit || createFallback();
  if (!/^[0-9a-f]{14,26}$/i.test(value)) {
    throw new NoriDocsPaymentError(
      "Masumi identifierFromPurchaser must be 14-26 hexadecimal characters."
    );
  }
  return value.toLowerCase();
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
