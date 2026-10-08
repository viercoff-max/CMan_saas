// LLM adapter. Default: OpenAI Chat Completions via fetch (OPENAI_API_KEY, OPENAI_MODEL).
// Without a key (or on API failure) a deterministic offline fallback answers extractively from the best chunk.
import type { Chunk } from "../types";
import type { Lang } from "./lang";
import { HANDOFF_TOKEN } from "./prompt";
import { tokenize } from "./retrieve";

export interface LLMRequest {
  system: string;
  user: string;
  /** Raw (redacted) customer question, used only by the offline fallback. */
  question: string;
  sources: Chunk[];
  lang: Lang;
}
export type LLM = (req: LLMRequest) => Promise<string>;

/** Deterministic extractive answer: best 1-2 sentences of the top chunk that overlap the question, else [HANDOFF]. */
export const offlineLLM: LLM = async (req) => {
  const top = req.sources[0];
  if (!top) return HANDOFF_TOKEN;
  const q = new Set(tokenize(req.question));
  const sentences = top.text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const scored = sentences.map((s, i) => ({ s, i, score: tokenize(s).filter((t) => q.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i);
  if (!scored.length) return HANDOFF_TOKEN;
  const words = scored.map((x) => x.s).join(" ").split(/\s+/);
  return words.slice(0, 80).join(" ") + (words.length > 80 ? "…" : "");
};

export function openAiLLM(apiKey: string, model: string, timeoutMs = 15000): LLM {
  return async (req) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 300,
          messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = data.choices?.[0]?.message?.content?.trim();
      if (!out) throw new Error("openai empty");
      return out;
    } catch (e) {
      // Never log the request (may contain customer text). Status only.
      console.warn("[engine] LLM unavailable, using offline fallback:", e instanceof Error ? e.message : "error");
      return offlineLLM(req);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Resolved at call time so env changes (tests, setup) are honored. */
export function defaultLLM(): LLM {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return offlineLLM;
  return openAiLLM(key, process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini");
}
