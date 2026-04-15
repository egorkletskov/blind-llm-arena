import type { BattleAnswer, ProviderId } from "./providers";

export type TaskPreset = {
  id: string;
  name: string;
  signal: string;
  prompt: string;
  systemPrompt: string;
  rubric: string[];
};

export type LeaderboardEntry = {
  key: string;
  provider: ProviderId;
  model: string;
  wins: number;
  battles: number;
  avgLatencyMs: number;
};

export type BattleRecord = {
  id: string;
  prompt: string;
  presetName: string;
  winnerKey: string;
  winnerLabel: string;
  note: string;
  createdAt: string;
  answers: BattleAnswer[];
};

export const taskPresets: TaskPreset[] = [
  {
    id: "support",
    name: "Support reply",
    signal: "Empathy + exact next step",
    prompt:
      "A B2B client writes: \"Your AI automation marked 74 good leads as low priority and the sales team missed the follow-up window. What happened and what are you doing today?\" Draft the response from an implementation lead.",
    systemPrompt:
      "You are writing as a senior AI automation consultant. Be specific, calm, accountable, and operational. Do not overpromise. Include immediate containment, root-cause hypothesis, data needed, and the next customer-visible update.",
    rubric: ["Specific containment", "No fake certainty", "Clear owner/date", "Customer-safe tone"],
  },
  {
    id: "lead",
    name: "Lead scoring",
    signal: "Decision quality",
    prompt:
      "Score this inbound lead from 1-5 and explain the next action: 220-person logistics company, uses HubSpot and WhatsApp, wants to automate shipment status replies, has no internal AI team, budget is unclear, requested a pilot in two weeks.",
    systemPrompt:
      "You are evaluating B2B AI automation opportunities. Return a concise score, confidence, missing data, and one practical next step. Penalize vague enterprise fluff.",
    rubric: ["Useful score", "Confidence stated", "Missing data", "Practical next action"],
  },
  {
    id: "rag",
    name: "RAG answer",
    signal: "Grounded response",
    prompt:
      "Based only on this policy excerpt, answer the customer: \"Can I export automation audit logs?\" Excerpt: Audit logs are retained for 180 days on Business plans. Admins can filter by user, workflow, event type, and date. CSV export is available only on Enterprise plans. API export requires a signed data processing addendum.",
    systemPrompt:
      "Answer only from the supplied context. If the user's plan is unknown, say what is known and what must be checked. Avoid inventing plan entitlements.",
    rubric: ["Grounded", "Plan caveat", "No hallucinated feature", "Concise"],
  },
  {
    id: "strategy",
    name: "Automation memo",
    signal: "Executive usefulness",
    prompt:
      "Write a 7-bullet internal memo for a founder deciding whether to automate first-line support with LLMs. Company: marketplace with 18k monthly tickets, 6 support agents, multilingual customers, refund edge cases, and strict brand tone.",
    systemPrompt:
      "You are a pragmatic AI automation engineer advising a founder. Prefer phased rollout, measurable risk controls, and operational detail. Avoid generic AI hype.",
    rubric: ["Phased rollout", "Risk controls", "Metrics", "Founder-level clarity"],
  },
];

export const demoAnswers: BattleAnswer[] = [
  {
    id: "demo-a",
    slot: "A",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    status: "ok",
    latencyMs: 1280,
    text:
      "I’d separate the response into containment and correction: pause the lead-priority automation for the affected segment, re-run the last 14 days through the previous rules, and give sales a recovery list within two hours. I would tell the client we are checking whether the issue came from a changed CRM field, a prompt regression, or a threshold miscalibration, then send a timestamped incident note by end of day.",
  },
  {
    id: "demo-b",
    slot: "B",
    provider: "anthropic",
    model: "claude-3-5-haiku-latest",
    status: "ok",
    latencyMs: 1760,
    text:
      "The strongest reply is direct: we found a prioritization failure, we are not asking the customer to absorb it, and we have already moved the affected leads into a manual review queue. The next message should include the exact number of leads reclassified, the decision rule being audited, and a rollback plan if confidence does not recover above the agreed threshold.",
  },
  {
    id: "demo-c",
    slot: "C",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    status: "ok",
    latencyMs: 620,
    text:
      "I would avoid technical blame in the first customer response. Say what changed operationally: the automation is in monitor-only mode, sales has the missed-lead list, and the next status update is scheduled. Then explain the investigation path in plain language: data mapping, model output sample, threshold history, and human review coverage.",
  },
];

export function createEmptyLeaderboard() {
  return new Map<string, LeaderboardEntry>();
}

export function modelKey(provider: ProviderId, model: string) {
  return `${provider}:${model}`;
}
