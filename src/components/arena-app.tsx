"use client";

import { useEffect, useState, useTransition } from "react";
import {
  type BattleRecord,
  demoAnswers,
  type LeaderboardEntry,
  modelKey,
  taskPresets,
  type TaskPreset,
} from "@/lib/arena-data";
import {
  type BattleAnswer,
  type CandidateConfig,
  type ProviderId,
  type ProviderModel,
  providerDefinitions,
  providerMap,
} from "@/lib/providers";

type ProviderState = {
  apiKey: string;
  baseUrl: string;
  models: ProviderModel[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

type CandidateSlot = {
  id: string;
  provider: ProviderId;
  model: string;
};

type BattleResponse = {
  battleId: string;
  createdAt: string;
  answers: BattleAnswer[];
};

const PROVIDERS_STORAGE_KEY = "blind-llm-arena.providers.v1";
const LEADERBOARD_STORAGE_KEY = "blind-llm-arena.leaderboard.v1";
const HISTORY_STORAGE_KEY = "blind-llm-arena.history.v1";

const initialProviderState = Object.fromEntries(
  providerDefinitions.map((provider) => [
    provider.id,
    {
      apiKey: "",
      baseUrl: provider.baseUrl,
      models: provider.featured.map((model) => ({ id: model, name: model })),
      status: "idle",
    },
  ]),
) as Record<ProviderId, ProviderState>;

const defaultSlots: CandidateSlot[] = [
  { id: "candidate-1", provider: "openrouter", model: "openai/gpt-4o-mini" },
  { id: "candidate-2", provider: "openrouter", model: "anthropic/claude-3.5-haiku" },
  { id: "candidate-3", provider: "groq", model: "llama-3.3-70b-versatile" },
];

export function ArenaApp() {
  const [providers, setProviders] =
    useState<Record<ProviderId, ProviderState>>(initialProviderState);
  const [slots, setSlots] = useState<CandidateSlot[]>(defaultSlots);
  const [activePresetId, setActivePresetId] = useState(taskPresets[0].id);
  const [prompt, setPrompt] = useState(taskPresets[0].prompt);
  const [systemPrompt, setSystemPrompt] = useState(taskPresets[0].systemPrompt);
  const [temperature, setTemperature] = useState(0.7);
  const [answers, setAnswers] = useState<BattleAnswer[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [judgeNote, setJudgeNote] = useState("");
  const [battleError, setBattleError] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<BattleRecord[]>([]);
  const [isPending, startTransition] = useTransition();

  const activePreset =
    taskPresets.find((preset) => preset.id === activePresetId) || taskPresets[0];
  const readyProviders = providerDefinitions.filter(
    (provider) => providers[provider.id].status === "ready",
  ).length;
  const runnableSlots = slots.filter((slot) => slot.model.trim());
  const selectedModels = runnableSlots.map((slot) => `${providerMap[slot.provider].shortName}/${slot.model}`);
  const hasVoted = Boolean(winnerId);

  useEffect(() => {
    const savedProviders = safeReadStorage<Record<ProviderId, ProviderState>>(PROVIDERS_STORAGE_KEY);
    const savedLeaderboard = safeReadStorage<LeaderboardEntry[]>(LEADERBOARD_STORAGE_KEY);
    const savedHistory = safeReadStorage<BattleRecord[]>(HISTORY_STORAGE_KEY);

    if (savedProviders) {
      setProviders(mergeProviderState(savedProviders));
    }

    if (savedLeaderboard) {
      setLeaderboard(savedLeaderboard);
    }

    if (savedHistory) {
      setHistory(savedHistory);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(providers));
  }, [providers]);

  useEffect(() => {
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(leaderboard));
  }, [leaderboard]);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 20)));
  }, [history]);

  function selectPreset(preset: TaskPreset) {
    setActivePresetId(preset.id);
    setPrompt(preset.prompt);
    setSystemPrompt(preset.systemPrompt);
    setAnswers([]);
    setWinnerId(null);
    setJudgeNote("");
    setBattleError("");
  }

  function updateProvider(provider: ProviderId, patch: Partial<ProviderState>) {
    setProviders((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        ...patch,
      },
    }));
  }

  async function loadModels(provider: ProviderId) {
    const state = providers[provider];
    updateProvider(provider, { status: "loading", error: undefined });

    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load models.");
      }

      const models = Array.isArray(data.models) ? data.models : [];
      updateProvider(provider, {
        models,
        status: "ready",
        error: undefined,
      });

      setSlots((current) =>
        current.map((slot) => {
          if (slot.provider !== provider || models.some((model: ProviderModel) => model.id === slot.model)) {
            return slot;
          }

          return {
            ...slot,
            model: models[0]?.id || slot.model,
          };
        }),
      );
    } catch (error) {
      updateProvider(provider, {
        status: "error",
        error: error instanceof Error ? error.message : "Model loading failed.",
      });
    }
  }

  function autoFillArena() {
    const preferredProviders = providerDefinitions.filter(
      (provider) => providers[provider.id].models.length > 0,
    );
    const nextSlots = preferredProviders.slice(0, 4).map((provider, index) => ({
      id: `candidate-${index + 1}`,
      provider: provider.id,
      model: providers[provider.id].models[0]?.id || provider.featured[0],
    }));

    setSlots(nextSlots.length >= 2 ? nextSlots : defaultSlots);
    setAnswers([]);
    setWinnerId(null);
  }

  function updateSlot(slotId: string, patch: Partial<CandidateSlot>) {
    setSlots((current) =>
      current.map((slot) => {
        if (slot.id !== slotId) {
          return slot;
        }

        const provider = patch.provider || slot.provider;
        const models = providers[provider].models;
        const fallbackModel = models[0]?.id || providerMap[provider].featured[0] || "";

        return {
          ...slot,
          ...patch,
          model: patch.provider ? fallbackModel : patch.model || slot.model,
        };
      }),
    );
  }

  function addSlot() {
    if (slots.length >= 4) {
      return;
    }

    const provider = providerDefinitions[slots.length % providerDefinitions.length];
    setSlots((current) => [
      ...current,
      {
        id: `candidate-${crypto.randomUUID()}`,
        provider: provider.id,
        model: providers[provider.id].models[0]?.id || provider.featured[0],
      },
    ]);
  }

  function removeSlot(slotId: string) {
    if (slots.length <= 2) {
      return;
    }

    setSlots((current) => current.filter((slot) => slot.id !== slotId));
  }

  function runDemoBattle() {
    const shuffled = shuffleAnswers(demoAnswers).map((answer, index) => ({
      ...answer,
      id: crypto.randomUUID(),
      slot: ["A", "B", "C", "D"][index] || String(index + 1),
    }));

    setAnswers(shuffled);
    setWinnerId(null);
    setJudgeNote("");
    setBattleError("");
  }

  function runBattle() {
    setBattleError("");
    setAnswers([]);
    setWinnerId(null);
    setJudgeNote("");

    const candidates = buildCandidates();
    const missingKey = candidates.find((candidate) => {
      const provider = providerMap[candidate.provider];
      return provider.requiresKey && !candidate.apiKey;
    });

    if (prompt.trim().length < 8) {
      setBattleError("Prompt is too short. Add a real task for the models.");
      return;
    }

    if (candidates.length < 2) {
      setBattleError("Choose at least two models.");
      return;
    }

    if (missingKey) {
      setBattleError(`${providerMap[missingKey.provider].name} needs an API key before the battle.`);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/battle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            systemPrompt,
            temperature,
            candidates: shuffleCandidates(candidates),
          }),
        });
        const data = (await response.json()) as BattleResponse | { error?: string };

        if (!response.ok || !("answers" in data)) {
          const message = "error" in data && data.error ? data.error : "Battle failed.";
          throw new Error(message);
        }

        setAnswers(data.answers);
      } catch (error) {
        setBattleError(error instanceof Error ? error.message : "Battle failed.");
      }
    });
  }

  function buildCandidates(): CandidateConfig[] {
    return runnableSlots.map((slot) => {
      const providerState = providers[slot.provider];

      return {
        id: slot.id,
        provider: slot.provider,
        model: slot.model,
        apiKey: providerState.apiKey,
        baseUrl: providerState.baseUrl,
        label: `${providerMap[slot.provider].name} / ${slot.model}`,
      };
    });
  }

  function vote(answer: BattleAnswer) {
    setWinnerId(answer.id);
    const winnerKey = modelKey(answer.provider, answer.model);
    const winnerLabel = `${providerMap[answer.provider].name} / ${answer.model}`;
    const createdAt = new Date().toISOString();

    setLeaderboard((current) => updateLeaderboard(current, answers, answer));
    setHistory((current) => [
      {
        id: crypto.randomUUID(),
        prompt,
        presetName: activePreset.name,
        winnerKey,
        winnerLabel,
        note: judgeNote,
        createdAt,
        answers,
      },
      ...current,
    ]);
  }

  function exportBattle() {
    const payload = {
      prompt,
      preset: activePreset,
      selectedModels,
      winnerId,
      answers,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `blind-llm-arena-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#10100e] text-[#f4f0e7]">
      <section className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(246,166,58,0.22),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(110,231,183,0.16),transparent_28%),linear-gradient(135deg,#15130f_0%,#111827_58%,#100f0d_100%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:52px_52px]" />
        <div className="relative mx-auto flex max-w-[1500px] flex-col gap-8 px-5 py-6 md:px-8 lg:px-10">
          <header className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.36em] text-[#f6a63a]">
                Private model battles
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-[-0.06em] text-white md:text-6xl">
                Blind LLM Arena
              </h1>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm md:min-w-[460px]">
              <Metric label="Providers" value={`${readyProviders}/${providerDefinitions.length}`} />
              <Metric label="Models" value={String(selectedModels.length)} />
              <Metric label="Battles" value={String(history.length)} />
            </div>
          </header>

          <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)_340px]">
            <ProviderDock
              providers={providers}
              onUpdateProvider={updateProvider}
              onLoadModels={loadModels}
              onAutoFill={autoFillArena}
            />

            <section className="min-w-0 rounded-[2rem] border border-white/12 bg-[#151515]/82 p-4 shadow-2xl shadow-black/35 backdrop-blur md:p-5">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-5">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/45">
                      Battle room
                    </p>
                    <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-white">
                      Same task. Hidden labels. One winner.
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="button-secondary" onClick={runDemoBattle} type="button">
                      Run demo
                    </button>
                    <button className="button-primary" disabled={isPending} onClick={runBattle} type="button">
                      {isPending ? "Running..." : "Start battle"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {taskPresets.map((preset) => (
                    <button
                      className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                        preset.id === activePresetId
                          ? "border-[#f6a63a] bg-[#f6a63a] text-[#15100a]"
                          : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25 hover:text-white"
                      }`}
                      key={preset.id}
                      onClick={() => selectPreset(preset)}
                      type="button"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_260px]">
                  <label className="group">
                    <span className="label">Task prompt</span>
                    <textarea
                      className="arena-input min-h-40 resize-y"
                      onChange={(event) => setPrompt(event.target.value)}
                      value={prompt}
                    />
                  </label>
                  <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
                    <p className="label">Scoring rubric</p>
                    <div className="mt-3 space-y-2">
                      {activePreset.rubric.map((item) => (
                        <div className="flex items-center gap-2 text-sm text-white/72" key={item}>
                          <span className="h-1.5 w-1.5 rounded-full bg-[#f6a63a]" />
                          {item}
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-xs leading-5 text-white/45">
                      Signal: <span className="text-white/70">{activePreset.signal}</span>
                    </p>
                  </div>
                </div>

                <label>
                  <span className="label">Shared system prompt</span>
                  <textarea
                    className="arena-input min-h-24 resize-y"
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    value={systemPrompt}
                  />
                </label>
              </div>

              <ModelLineup
                onAddSlot={addSlot}
                onRemoveSlot={removeSlot}
                onUpdateSlot={updateSlot}
                providers={providers}
                slots={slots}
                temperature={temperature}
                onTemperatureChange={setTemperature}
              />

              {battleError ? (
                <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {battleError}
                </div>
              ) : null}

              <AnswerBoard
                answers={answers}
                hasVoted={hasVoted}
                isPending={isPending}
                judgeNote={judgeNote}
                onExport={exportBattle}
                onJudgeNote={setJudgeNote}
                onVote={vote}
                winnerId={winnerId}
              />
            </section>

            <Inspector
              history={history}
              leaderboard={leaderboard}
              onReset={() => {
                setLeaderboard([]);
                setHistory([]);
              }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function ProviderDock({
  providers,
  onUpdateProvider,
  onLoadModels,
  onAutoFill,
}: {
  providers: Record<ProviderId, ProviderState>;
  onUpdateProvider: (provider: ProviderId, patch: Partial<ProviderState>) => void;
  onLoadModels: (provider: ProviderId) => void;
  onAutoFill: () => void;
}) {
  return (
    <aside className="rounded-[2rem] border border-white/12 bg-[#f8efe0] p-4 text-[#17120d] shadow-2xl shadow-black/30 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-[#9a5d12]">Provider dock</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">Keys in. Models out.</h2>
        </div>
        <button
          className="rounded-full bg-[#17120d] px-3 py-2 text-xs font-bold text-[#f8efe0] transition hover:bg-[#3b2b1a]"
          onClick={onAutoFill}
          type="button"
        >
          Auto-fill
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#5f5140]">
        Paste a key, load models, then run a private blind test. Keys are saved only in this browser and sent
        to the local API route for the request.
      </p>

      <div className="mt-5 space-y-3">
        {providerDefinitions.map((provider) => {
          const state = providers[provider.id];
          const needsKey = provider.requiresKey;

          return (
            <div
              className="rounded-[1.35rem] border border-[#17120d]/10 bg-white/55 p-3 shadow-sm"
              key={provider.id}
              style={{ outlineColor: provider.accent }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: provider.accent }}
                    />
                    <h3 className="font-black">{provider.name}</h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#6a5b49]">{provider.description}</p>
                </div>
                <StatusPill status={state.status} />
              </div>

              <div className="mt-3 grid gap-2">
                {needsKey || provider.id === "custom" ? (
                  <input
                    className="light-input"
                    onChange={(event) => onUpdateProvider(provider.id, { apiKey: event.target.value })}
                    placeholder={provider.keyPlaceholder}
                    type="password"
                    value={state.apiKey}
                  />
                ) : null}
                <input
                  className="light-input font-mono text-[11px]"
                  onChange={(event) => onUpdateProvider(provider.id, { baseUrl: event.target.value })}
                  value={state.baseUrl}
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#6a5b49]">
                  {state.models.length} models loaded
                </span>
                <button
                  className="rounded-full bg-[#17120d] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#3b2b1a] disabled:opacity-50"
                  disabled={state.status === "loading"}
                  onClick={() => onLoadModels(provider.id)}
                  type="button"
                >
                  {state.status === "loading" ? "Loading" : "Load models"}
                </button>
              </div>

              {state.error ? <p className="mt-2 text-xs text-red-700">{state.error}</p> : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ModelLineup({
  providers,
  slots,
  temperature,
  onTemperatureChange,
  onAddSlot,
  onRemoveSlot,
  onUpdateSlot,
}: {
  providers: Record<ProviderId, ProviderState>;
  slots: CandidateSlot[];
  temperature: number;
  onTemperatureChange: (value: number) => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotId: string) => void;
  onUpdateSlot: (slotId: string, patch: Partial<CandidateSlot>) => void;
}) {
  return (
    <div className="border-b border-white/10 py-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <p className="label">Model lineup</p>
          <h3 className="text-xl font-bold tracking-[-0.04em] text-white">
            Pick 2-4 models. The order is shuffled before the answers return.
          </h3>
        </div>
        <button className="button-secondary" disabled={slots.length >= 4} onClick={onAddSlot} type="button">
          Add model
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        {slots.map((slot, index) => {
          const provider = providerMap[slot.provider];
          const models = providers[slot.provider].models.length
            ? providers[slot.provider].models
            : provider.featured.map((model) => ({ id: model, name: model }));

          return (
            <div
              className="grid gap-3 rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-3 md:grid-cols-[70px_180px_minmax(0,1fr)_auto]"
              key={slot.id}
            >
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-white/38">Slot</p>
                <p className="text-2xl font-black text-white">{index + 1}</p>
              </div>
              <select
                className="arena-input h-12"
                onChange={(event) =>
                  onUpdateSlot(slot.id, { provider: event.target.value as ProviderId })
                }
                value={slot.provider}
              >
                {providerDefinitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="arena-input h-12 font-mono text-xs"
                onChange={(event) => onUpdateSlot(slot.id, { model: event.target.value })}
                value={slot.model}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <button
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55 transition hover:border-red-300/30 hover:text-red-100 disabled:opacity-30"
                disabled={slots.length <= 2}
                onClick={() => onRemoveSlot(slot.id)}
                type="button"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <label className="mt-4 flex flex-col gap-2 rounded-[1.35rem] border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between">
          <span className="label">Temperature</span>
          <span className="font-mono text-sm text-[#f6a63a]">{temperature.toFixed(1)}</span>
        </div>
        <input
          max="1.2"
          min="0"
          onChange={(event) => onTemperatureChange(Number(event.target.value))}
          step="0.1"
          type="range"
          value={temperature}
        />
      </label>
    </div>
  );
}

function AnswerBoard({
  answers,
  hasVoted,
  isPending,
  judgeNote,
  winnerId,
  onJudgeNote,
  onVote,
  onExport,
}: {
  answers: BattleAnswer[];
  hasVoted: boolean;
  isPending: boolean;
  judgeNote: string;
  winnerId: string | null;
  onJudgeNote: (note: string) => void;
  onVote: (answer: BattleAnswer) => void;
  onExport: () => void;
}) {
  if (isPending) {
    return (
      <div className="grid min-h-72 place-items-center py-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[#f6a63a]" />
          <p className="mt-5 text-lg font-bold text-white">Calling models in parallel...</p>
          <p className="mt-2 text-sm text-white/45">The labels stay hidden until you vote.</p>
        </div>
      </div>
    );
  }

  if (!answers.length) {
    return (
      <div className="grid min-h-72 place-items-center py-8">
        <div className="max-w-lg text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#f6a63a]">No battle yet</p>
          <h3 className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">
            Run a demo or connect real models.
          </h3>
          <p className="mt-3 text-sm leading-6 text-white/50">
            A good battle compares models on one concrete business task, hides labels, and records the
            human winner.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <p className="label">Anonymous answers</p>
          <h3 className="text-xl font-bold tracking-[-0.04em] text-white">
            Vote first. Reveal model names after.
          </h3>
        </div>
        <button className="button-secondary" disabled={!answers.length} onClick={onExport} type="button">
          Export JSON
        </button>
      </div>

      {!hasVoted ? (
        <label className="mt-4 block">
          <span className="label">Judge note optional</span>
          <input
            className="arena-input h-12"
            onChange={(event) => onJudgeNote(event.target.value)}
            placeholder="Why did the winner win?"
            value={judgeNote}
          />
        </label>
      ) : null}

      <div className="mt-4 grid gap-3">
        {answers.map((answer) => {
          const isWinner = winnerId === answer.id;
          const provider = providerMap[answer.provider];

          return (
            <article
              className={`rounded-[1.5rem] border p-4 transition ${
                isWinner
                  ? "border-[#f6a63a] bg-[#f6a63a]/10"
                  : "border-white/10 bg-white/[0.035]"
              }`}
              key={answer.id}
            >
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-white/45">
                      Model {answer.slot}
                    </p>
                    {isWinner ? (
                      <span className="rounded-full bg-[#f6a63a] px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#15100a]">
                        Winner
                      </span>
                    ) : null}
                  </div>
                  {hasVoted ? (
                    <p className="mt-2 font-mono text-xs text-[#f6a63a]">
                      {provider.name} / {answer.model} / {answer.latencyMs}ms
                    </p>
                  ) : (
                    <p className="mt-2 font-mono text-xs text-white/32">identity hidden</p>
                  )}
                </div>
                {!hasVoted && answer.status === "ok" ? (
                  <button className="button-primary" onClick={() => onVote(answer)} type="button">
                    Pick winner
                  </button>
                ) : null}
              </div>

              {answer.status === "error" ? (
                <p className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">
                  {answer.error || "Model failed."}
                </p>
              ) : (
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/78">{answer.text}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Inspector({
  leaderboard,
  history,
  onReset,
}: {
  leaderboard: LeaderboardEntry[];
  history: BattleRecord[];
  onReset: () => void;
}) {
  const sortedLeaderboard = [...leaderboard].sort((a, b) => b.wins - a.wins || b.battles - a.battles);

  return (
    <aside className="rounded-[2rem] border border-white/12 bg-[#151515]/82 p-4 shadow-2xl shadow-black/35 backdrop-blur md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Leaderboard</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Local truth table</h2>
        </div>
        <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-white/55" onClick={onReset} type="button">
          Reset
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {sortedLeaderboard.length ? (
          sortedLeaderboard.map((entry, index) => (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-3" key={entry.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-[#f6a63a]">
                    #{index + 1}
                  </p>
                  <h3 className="mt-1 break-all font-mono text-xs text-white">{entry.model}</h3>
                  <p className="mt-1 text-xs text-white/45">{providerMap[entry.provider].name}</p>
                </div>
                <p className="text-3xl font-black text-white">{entry.wins}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <MiniStat label="Win rate" value={`${Math.round((entry.wins / entry.battles) * 100)}%`} />
                <MiniStat label="Battles" value={String(entry.battles)} />
                <MiniStat label="Latency" value={`${Math.round(entry.avgLatencyMs)}ms`} />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-white/50">
            Vote on a model to start a local leaderboard. Nothing leaves the browser.
          </p>
        )}
      </div>

      <div className="mt-6">
        <p className="label">Battle log</p>
        <div className="mt-3 space-y-3">
          {history.slice(0, 5).map((battle) => (
            <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-3" key={battle.id}>
              <p className="text-xs font-bold text-white">{battle.presetName}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-[#f6a63a]">{battle.winnerLabel}</p>
              {battle.note ? <p className="mt-2 text-xs leading-5 text-white/45">{battle.note}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/38">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-white">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.05] px-2 py-2">
      <p className="text-white">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-white/35">{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: ProviderState["status"] }) {
  const label = {
    idle: "Idle",
    loading: "Syncing",
    ready: "Ready",
    error: "Error",
  }[status];

  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
        status === "ready"
          ? "bg-emerald-600 text-white"
          : status === "error"
            ? "bg-red-700 text-white"
            : "bg-[#17120d]/10 text-[#5f5140]"
      }`}
    >
      {label}
    </span>
  );
}

function updateLeaderboard(
  current: LeaderboardEntry[],
  answers: BattleAnswer[],
  winner: BattleAnswer,
) {
  const map = new Map(current.map((entry) => [entry.key, entry]));
  const okAnswers = answers.filter((answer) => answer.status === "ok");

  for (const answer of okAnswers) {
    const key = modelKey(answer.provider, answer.model);
    const previous = map.get(key);
    const battles = (previous?.battles || 0) + 1;
    const wins = (previous?.wins || 0) + (answer.id === winner.id ? 1 : 0);
    const previousLatency = previous?.avgLatencyMs || answer.latencyMs;
    const avgLatencyMs = previous
      ? (previousLatency * previous.battles + answer.latencyMs) / battles
      : answer.latencyMs;

    map.set(key, {
      key,
      provider: answer.provider,
      model: answer.model,
      wins,
      battles,
      avgLatencyMs,
    });
  }

  return Array.from(map.values());
}

function mergeProviderState(saved: Record<ProviderId, ProviderState>) {
  const merged = { ...initialProviderState };

  for (const provider of providerDefinitions) {
    if (saved[provider.id]) {
      merged[provider.id] = {
        ...merged[provider.id],
        ...saved[provider.id],
        status: "idle",
        error: undefined,
      };
    }
  }

  return merged;
}

function safeReadStorage<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function shuffleCandidates(candidates: CandidateConfig[]) {
  return [...candidates].sort(() => Math.random() - 0.5);
}

function shuffleAnswers(answers: BattleAnswer[]) {
  return [...answers].sort(() => Math.random() - 0.5);
}
