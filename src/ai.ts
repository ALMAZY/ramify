// AI Assist with the user's own provider: Claude API, OpenAI, OpenRouter, or a
// local model through Ollama / LM Studio (any OpenAI-compatible endpoint).
// Nothing is sent anywhere until the user configures a provider.

import type { Store } from "./storage";
import { isDesktop } from "./storage";
import { MapNode, pathTo } from "./model";
import { branchToMarkdown } from "./markdown";

export type ProviderKind = "anthropic" | "openai";

export interface AISettings {
  preset: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  language: string; // "" = same language as the map
}

export const PRESETS: { id: string; name: string; kind: ProviderKind; baseUrl: string; model: string; needsKey: boolean; hint: string }[] = [
  { id: "anthropic", name: "Claude (Anthropic API)", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", needsKey: true, hint: "Key from console.anthropic.com" },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "", needsKey: true, hint: "Key from platform.openai.com; enter a model name" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "", needsKey: true, hint: "One key for many models; enter a model id" },
  { id: "ollama", name: "Ollama (local, free)", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", needsKey: false, hint: "Runs on your computer; install from ollama.com" },
  { id: "lmstudio", name: "LM Studio (local, free)", kind: "openai", baseUrl: "http://localhost:1234/v1", model: "", needsKey: false, hint: "Start the local server in LM Studio" },
  { id: "custom", name: "Other OpenAI-compatible", kind: "openai", baseUrl: "", model: "", needsKey: false, hint: "Any /chat/completions endpoint" },
];

const KEY = "lm:ai";

export function loadAISettings(): AISettings | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && v.baseUrl ? v : null;
  } catch {
    return null;
  }
}

export function saveAISettings(s: AISettings | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

export async function complete(store: Store, s: AISettings, system: string, user: string): Promise<string> {
  const base = s.baseUrl.replace(/\/+$/, "");
  if (s.kind === "anthropic") {
    const headers: [string, string][] = [
      ["content-type", "application/json"],
      ["x-api-key", s.apiKey],
      ["anthropic-version", "2023-06-01"],
    ];
    if (!isDesktop()) headers.push(["anthropic-dangerous-direct-browser-access", "true"]);
    const r = await store.http(`${base}/messages`, "POST", headers, JSON.stringify({ model: s.model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] }));
    const j = parseJSON(r.body);
    if (r.status >= 400) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
    return (j?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  }
  const headers: [string, string][] = [["content-type", "application/json"]];
  if (s.apiKey) headers.push(["authorization", `Bearer ${s.apiKey}`]);
  const r = await store.http(
    `${base}/chat/completions`,
    "POST",
    headers,
    JSON.stringify({ model: s.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  );
  const j = parseJSON(r.body);
  if (r.status >= 400) throw new Error(j?.error?.message ?? j?.error ?? `HTTP ${r.status}`);
  return j?.choices?.[0]?.message?.content ?? "";
}

function parseJSON(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export type AIAction = "expand" | "next" | "summarize" | "compare";

export const AI_ACTIONS: { id: AIAction; title: string; keys?: string; result: "children" | "note" }[] = [
  { id: "expand", title: "AI: expand topic (add sub-topics)", keys: "Mod+Shift+I", result: "children" },
  { id: "next", title: "AI: suggest next steps (as tasks)", result: "children" },
  { id: "summarize", title: "AI: summarize branch into notes", result: "note" },
  { id: "compare", title: "AI: compare the options (sub-topics)", result: "note" },
];

/** Build the prompt for an action on topic `n` of map `root`. */
export function buildPrompt(action: AIAction, root: MapNode, n: MapNode, language: string): { system: string; user: string } {
  const path = pathTo(root, n.id)
    .map((x) => x.text.replace(/\n/g, " "))
    .join(" › ");
  const branch = branchToMarkdown(n);
  const lang = language ? `Write in ${language}.` : "Write in the same language as the map.";
  const system = `You help people think in mind maps. ${lang} Be concise: topics are short phrases (2-8 words), not sentences. Never add commentary before or after the answer.`;
  const ctx = `Map path: ${path}\n\nCurrent branch (Markdown outline):\n${branch}`;
  switch (action) {
    case "expand":
      return { system, user: `${ctx}\nSuggest 4-7 new sub-topics for "${n.text}" that are not already there. Each may have up to 3 sub-points. Answer ONLY with a Markdown bullet list (nested with two spaces).` };
    case "next":
      return { system, user: `${ctx}\nSuggest 3-6 concrete next steps to move "${n.text}" forward. Answer ONLY with a Markdown task list: "- [ ] step".` };
    case "summarize":
      return { system, user: `${ctx}\nSummarize this branch in 3-6 short bullet points that capture the key ideas. Answer ONLY with Markdown bullets.` };
    case "compare":
      return {
        system,
        user: `${ctx}\nThe sub-topics of "${n.text}" are options. Compare them: a short Markdown table (option, pros, cons), then one line "Pick:" with the best choice and why. Answer ONLY with that Markdown.`,
      };
  }
}

/** Remove code fences and leading prose a model may add despite instructions. */
export function cleanList(text: string): string {
  let t = text.replace(/^```[a-z]*\n?|```$/gim, "").trim();
  const lines = t.split("\n");
  const first = lines.findIndex((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l));
  if (first > 0) t = lines.slice(first).join("\n");
  return t;
}
