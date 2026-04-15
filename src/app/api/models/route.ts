import { listProviderModels, ProviderRuntimeError } from "@/lib/provider-runtime";
import { isProviderId, type ProviderConnection } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connection = parseConnection(body);
    const models = await listProviderModels(connection);

    return Response.json({
      models,
      count: models.length,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load models.",
      },
      {
        status: error instanceof ProviderRuntimeError && error.status ? error.status : 400,
      },
    );
  }
}

function parseConnection(value: unknown): ProviderConnection {
  if (!value || typeof value !== "object") {
    throw new Error("Expected provider connection payload.");
  }

  const record = value as Record<string, unknown>;
  const provider = String(record.provider || "");

  if (!isProviderId(provider)) {
    throw new Error("Unknown provider.");
  }

  return {
    provider,
    apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : undefined,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl.trim() : undefined,
  };
}
