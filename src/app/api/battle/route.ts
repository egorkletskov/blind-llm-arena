import { runBattleCandidate } from "@/lib/provider-runtime";
import { isProviderId, type CandidateConfig } from "@/lib/providers";

export const runtime = "nodejs";

const MAX_CANDIDATES = 4;
const SLOT_NAMES = ["A", "B", "C", "D"];

type BattlePayload = {
  prompt: string;
  systemPrompt: string;
  temperature?: number;
  candidates: CandidateConfig[];
};

export async function POST(request: Request) {
  try {
    const payload = parseBattlePayload(await request.json());
    const answers = await Promise.all(
      payload.candidates.map((candidate, index) =>
        runBattleCandidate({
          prompt: payload.prompt,
          systemPrompt: payload.systemPrompt,
          candidate,
          temperature: payload.temperature,
          slot: SLOT_NAMES[index] || String(index + 1),
        }),
      ),
    );

    return Response.json({
      battleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      answers,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Battle failed.",
      },
      { status: 400 },
    );
  }
}

function parseBattlePayload(value: unknown): BattlePayload {
  if (!value || typeof value !== "object") {
    throw new Error("Expected battle payload.");
  }

  const record = value as Record<string, unknown>;
  const prompt = stringField(record.prompt);
  const systemPrompt = stringField(record.systemPrompt);
  const temperature = numberField(record.temperature, 0.7);
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];

  if (prompt.length < 8) {
    throw new Error("Prompt is too short for a fair battle.");
  }

  if (!systemPrompt) {
    throw new Error("System prompt is required.");
  }

  if (candidates.length < 2 || candidates.length > MAX_CANDIDATES) {
    throw new Error("Choose 2 to 4 models for a battle.");
  }

  return {
    prompt,
    systemPrompt,
    temperature,
    candidates: candidates.map(parseCandidate),
  };
}

function parseCandidate(value: unknown, index: number): CandidateConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`Candidate ${index + 1} is invalid.`);
  }

  const record = value as Record<string, unknown>;
  const provider = stringField(record.provider);
  const model = stringField(record.model);

  if (!isProviderId(provider)) {
    throw new Error(`Candidate ${index + 1} has an unknown provider.`);
  }

  if (!model) {
    throw new Error(`Candidate ${index + 1} is missing a model.`);
  }

  return {
    id: stringField(record.id) || crypto.randomUUID(),
    provider,
    model,
    apiKey: stringField(record.apiKey) || undefined,
    baseUrl: stringField(record.baseUrl) || undefined,
    label: stringField(record.label) || undefined,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
