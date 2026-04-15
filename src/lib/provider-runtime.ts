import {
  type BattleAnswer,
  type CandidateConfig,
  getBaseUrl,
  getProvider,
  type ProviderConnection,
  type ProviderModel,
} from "./providers";

const APP_TITLE = "Blind LLM Arena";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 900;

type BattleRunInput = {
  prompt: string;
  systemPrompt: string;
  candidate: CandidateConfig;
  temperature?: number;
  slot: string;
};

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type JsonObject = Record<string, unknown>;

export class ProviderRuntimeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderRuntimeError";
  }
}

export async function listProviderModels(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);

  if (provider.id === "ollama") {
    return listOllamaModels(connection);
  }

  if (provider.kind === "google") {
    return listGoogleModels(connection);
  }

  if (provider.kind === "anthropic") {
    return listAnthropicModels(connection);
  }

  return listOpenAICompatibleModels(connection);
}

export async function runBattleCandidate({
  prompt,
  systemPrompt,
  candidate,
  temperature = 0.7,
  slot,
}: BattleRunInput): Promise<BattleAnswer> {
  const startedAt = Date.now();

  try {
    const text = await generateText({
      candidate,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature,
    });

    return {
      id: crypto.randomUUID(),
      slot,
      provider: candidate.provider,
      model: candidate.model,
      text,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    };
  } catch (error) {
    return {
      id: crypto.randomUUID(),
      slot,
      provider: candidate.provider,
      model: candidate.model,
      text: "",
      latencyMs: Date.now() - startedAt,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown provider error",
    };
  }
}

async function generateText({
  candidate,
  messages,
  temperature,
}: {
  candidate: CandidateConfig;
  messages: OpenAIMessage[];
  temperature: number;
}) {
  const provider = getProvider(candidate.provider);

  if (provider.kind === "anthropic") {
    return generateAnthropic(candidate, messages, temperature);
  }

  if (provider.kind === "google") {
    return generateGoogle(candidate, messages, temperature);
  }

  return generateOpenAICompatible(candidate, messages, temperature);
}

async function generateOpenAICompatible(
  candidate: CandidateConfig,
  messages: OpenAIMessage[],
  temperature: number,
) {
  const provider = getProvider(candidate.provider);
  const baseUrl = getOpenAIChatBaseUrl(candidate);
  const headers = buildAuthHeaders(candidate);

  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/egorkletskov/blind-llm-arena";
    headers["X-Title"] = APP_TITLE;
  }

  const json = await postJson(`${baseUrl}/chat/completions`, {
    headers,
    body: {
      model: candidate.model,
      messages,
      temperature,
      max_tokens: DEFAULT_MAX_TOKENS,
    },
  });

  const choices = getArray(json, "choices");
  const first = getObject(choices[0]);
  const message = getObject(first.message);
  const content = getString(message.content);

  if (!content) {
    throw new ProviderRuntimeError("Provider returned an empty completion.");
  }

  return content;
}

async function generateAnthropic(
  candidate: CandidateConfig,
  messages: OpenAIMessage[],
  temperature: number,
) {
  const baseUrl = getBaseUrl(candidate);
  const systemPrompt = messages.find((message) => message.role === "system")?.content || "";
  const userPrompt = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");

  const json = await postJson(`${baseUrl}/v1/messages`, {
    headers: {
      "x-api-key": candidate.apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: candidate.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
  });

  const content = getArray(json, "content")
    .map((part) => getObject(part))
    .map((part) => getString(part.text))
    .filter(Boolean)
    .join("\n\n");

  if (!content) {
    throw new ProviderRuntimeError("Anthropic returned an empty message.");
  }

  return content;
}

async function generateGoogle(
  candidate: CandidateConfig,
  messages: OpenAIMessage[],
  temperature: number,
) {
  const baseUrl = getBaseUrl(candidate);
  const key = encodeURIComponent(candidate.apiKey || "");
  const combinedPrompt = messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

  const json = await postJson(
    `${baseUrl}/models/${encodeURIComponent(candidate.model)}:generateContent?key=${key}`,
    {
      headers: {},
      body: {
        contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: DEFAULT_MAX_TOKENS,
        },
      },
    },
  );

  const candidates = getArray(json, "candidates");
  const first = getObject(candidates[0]);
  const content = getObject(first.content);
  const text = getArray(content, "parts")
    .map((part) => getObject(part))
    .map((part) => getString(part.text))
    .filter(Boolean)
    .join("\n\n");

  if (!text) {
    throw new ProviderRuntimeError("Google returned an empty candidate.");
  }

  return text;
}

async function listOpenAICompatibleModels(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);
  const baseUrl = getOpenAIChatBaseUrl(connection);
  const headers = buildAuthHeaders(connection);

  if (!connection.apiKey && provider.requiresKey) {
    return provider.featured.map((model) => modelToProviderModel(model));
  }

  const json = await getJson(`${baseUrl}/models`, { headers });
  const data = getArray(json, "data");

  if (!data.length) {
    return provider.featured.map((model) => modelToProviderModel(model));
  }

  return data
    .map((model) => normalizeModelObject(model))
    .filter((model): model is ProviderModel => Boolean(model))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listAnthropicModels(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);

  if (!connection.apiKey) {
    return provider.featured.map((model) => modelToProviderModel(model));
  }

  try {
    const json = await getJson(`${getBaseUrl(connection)}/v1/models`, {
      headers: {
        "x-api-key": connection.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    const data = getArray(json, "data");
    const models = data
      .map((model) => normalizeModelObject(model))
      .filter((model): model is ProviderModel => Boolean(model));

    return models.length ? models : provider.featured.map((model) => modelToProviderModel(model));
  } catch {
    return provider.featured.map((model) => modelToProviderModel(model));
  }
}

async function listGoogleModels(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);

  if (!connection.apiKey) {
    return provider.featured.map((model) => modelToProviderModel(model));
  }

  const key = encodeURIComponent(connection.apiKey);
  const json = await getJson(`${getBaseUrl(connection)}/models?key=${key}`, { headers: {} });
  const models = getArray(json, "models")
    .map((model) => getObject(model))
    .filter((model) => {
      const methods = getArray(model, "supportedGenerationMethods");
      return methods.includes("generateContent");
    })
    .map((model) => {
      const id = getString(model.name).replace(/^models\//, "");
      return id ? modelToProviderModel(id) : undefined;
    })
    .filter((model): model is ProviderModel => Boolean(model));

  return models.length ? models : provider.featured.map((model) => modelToProviderModel(model));
}

async function listOllamaModels(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);
  const baseUrl = getBaseUrl(connection).replace(/\/v1$/, "");

  try {
    const json = await getJson(`${baseUrl}/api/tags`, { headers: {} });
    const models = getArray(json, "models")
      .map((model) => getObject(model))
      .map((model) => getString(model.name))
      .filter(Boolean)
      .map((model) => modelToProviderModel(model));

    return models.length ? models : provider.featured.map((model) => modelToProviderModel(model));
  } catch {
    return provider.featured.map((model) => modelToProviderModel(model));
  }
}

async function getJson(url: string, { headers }: { headers: Record<string, string> }) {
  return requestJson(url, {
    method: "GET",
    headers,
  });
}

async function postJson(
  url: string,
  {
    headers,
    body,
  }: {
    headers: Record<string, string>;
    body: JsonObject;
  },
) {
  return requestJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function requestJson(
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });

    const text = await response.text();
    const json = getObject(text ? safeJsonParse(text) : {});

    if (!response.ok) {
      throw new ProviderRuntimeError(readProviderError(json) || response.statusText, response.status);
    }

    return json;
  } catch (error) {
    if (error instanceof ProviderRuntimeError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderRuntimeError("Provider request timed out.");
    }

    throw new ProviderRuntimeError(error instanceof Error ? error.message : "Provider request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function buildAuthHeaders(connection: ProviderConnection) {
  const headers: Record<string, string> = {};

  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  }

  return headers;
}

function getOpenAIChatBaseUrl(connection: ProviderConnection) {
  const baseUrl = getBaseUrl(connection);

  if (connection.provider === "ollama" && !baseUrl.endsWith("/v1")) {
    return `${baseUrl}/v1`;
  }

  return baseUrl;
}

function normalizeModelObject(value: unknown): ProviderModel | undefined {
  const model = getObject(value);
  const id = getString(model.id) || getString(model.name);

  if (!id) {
    return undefined;
  }

  const pricing = getObject(model.pricing);
  const topProvider = getObject(model.top_provider);

  return {
    id,
    name: getString(model.name) || id,
    context: getNumber(model.context_length) || getNumber(topProvider.context_length),
    inputPrice: normalizePrice(getString(pricing.prompt)),
    outputPrice: normalizePrice(getString(pricing.completion)),
  };
}

function modelToProviderModel(id: string): ProviderModel {
  return {
    id,
    name: id,
  };
}

function normalizePrice(value: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readProviderError(json: JsonObject) {
  const error = getObject(json.error);
  const message = getString(error.message) || getString(json.message) || getString(error.error);
  return message;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function getArray(value: JsonObject, key: string): unknown[];
function getArray(value: unknown, key: string): unknown[];
function getArray(value: unknown, key: string) {
  const object = getObject(value);
  const result = object[key];
  return Array.isArray(result) ? result : [];
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
