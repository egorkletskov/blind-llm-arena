export type ProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "mistral"
  | "together"
  | "ollama"
  | "custom";

export type ProviderKind = "openai-compatible" | "anthropic" | "google";

export type ProviderDefinition = {
  id: ProviderId;
  name: string;
  shortName: string;
  kind: ProviderKind;
  baseUrl: string;
  modelEndpoint?: string;
  requiresKey: boolean;
  accent: string;
  description: string;
  docsUrl: string;
  featured: string[];
  keyPlaceholder: string;
};

export type ProviderConnection = {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
};

export type ProviderModel = {
  id: string;
  name: string;
  context?: number;
  inputPrice?: number;
  outputPrice?: number;
};

export type CandidateConfig = ProviderConnection & {
  id: string;
  model: string;
  label?: string;
};

export type BattleAnswer = {
  id: string;
  slot: string;
  provider: ProviderId;
  model: string;
  text: string;
  latencyMs: number;
  status: "ok" | "error";
  error?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export const providerDefinitions: ProviderDefinition[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    shortName: "Router",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
    accent: "#f6a63a",
    description: "One key for many frontier and open models.",
    docsUrl: "https://openrouter.ai/docs",
    featured: [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-haiku",
      "google/gemini-flash-1.5",
    ],
    keyPlaceholder: "sk-or-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    requiresKey: true,
    accent: "#6ee7b7",
    description: "Direct OpenAI Chat Completions-compatible endpoint.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    featured: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    shortName: "Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    requiresKey: true,
    accent: "#d8c3a5",
    description: "Claude models through the Messages API.",
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    featured: [
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-opus-latest",
    ],
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "google",
    name: "Google Gemini",
    shortName: "Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresKey: true,
    accent: "#9cc9ff",
    description: "Gemini models through the Generative Language API.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    featured: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
    keyPlaceholder: "AIza...",
  },
  {
    id: "groq",
    name: "Groq",
    shortName: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    requiresKey: true,
    accent: "#ff7a59",
    description: "Fast OpenAI-compatible inference for open models.",
    docsUrl: "https://console.groq.com/docs/openai",
    featured: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    keyPlaceholder: "gsk_...",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    shortName: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    requiresKey: true,
    accent: "#ffce5c",
    description: "Mistral chat models on an OpenAI-style API.",
    docsUrl: "https://docs.mistral.ai/api/",
    featured: ["mistral-small-latest", "mistral-large-latest", "open-mixtral-8x22b"],
    keyPlaceholder: "API key",
  },
  {
    id: "together",
    name: "Together AI",
    shortName: "Together",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    requiresKey: true,
    accent: "#c084fc",
    description: "Hosted open models through an OpenAI-compatible API.",
    docsUrl: "https://docs.together.ai/docs/openai-api-compatibility",
    featured: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
    keyPlaceholder: "API key",
  },
  {
    id: "ollama",
    name: "Ollama",
    shortName: "Local",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434",
    requiresKey: false,
    accent: "#a3e635",
    description: "Local models, no cloud key required.",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    featured: ["llama3.2", "qwen2.5", "mistral"],
    keyPlaceholder: "No key",
  },
  {
    id: "custom",
    name: "Custom compatible",
    shortName: "Custom",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    requiresKey: false,
    accent: "#f5f5f4",
    description: "Any OpenAI-compatible endpoint with /chat/completions.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    featured: ["model-id"],
    keyPlaceholder: "Optional bearer token",
  },
];

export const providerMap = Object.fromEntries(
  providerDefinitions.map((provider) => [provider.id, provider]),
) as Record<ProviderId, ProviderDefinition>;

export function getProvider(provider: ProviderId) {
  return providerMap[provider];
}

export function getBaseUrl(connection: ProviderConnection) {
  const provider = getProvider(connection.provider);
  return (connection.baseUrl || provider.baseUrl).replace(/\/$/, "");
}

export function isProviderId(value: string): value is ProviderId {
  return value in providerMap;
}
