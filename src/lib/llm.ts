import "server-only";

/** A language model, behind one function, so which company answers is a
 *  setting and not a rewrite.
 *
 *  ## Why one function and three `fetch`es rather than three SDKs
 *
 *  John Lau asks a model exactly one kind of thing: *here are the rules, here
 *  is the conversation, answer this in JSON*. That is one request shape, and
 *  every provider this business might reasonably pick accepts it over plain
 *  HTTPS. An SDK per provider would be three dependencies to keep current in a
 *  Worker bundle, to say what forty lines of `fetch` say (07: no dependency
 *  for something the platform already does).
 *
 *  ## Choosing, and changing
 *
 *      ASSISTANT_LLM_PROVIDER   gemini (default) | anthropic | openai
 *      ASSISTANT_LLM_API_KEY    the key for that provider
 *      ASSISTANT_LLM_MODEL      optional; each provider has a default below
 *      ASSISTANT_LLM_BASE_URL   openai only — any OpenAI-compatible endpoint
 *                               (OpenRouter, a local Ollama, Azure's gateway)
 *
 *  Changing provider is changing those variables on the Worker. Nothing else
 *  reads them, and nothing in the screens knows which one answered.
 *
 *  **Runtime secrets, never `NEXT_PUBLIC_`.** The same rule as the Supabase
 *  service key and the Drive key, enforced the same way: a key under that
 *  prefix is already in every browser, so it is refused rather than read.
 */

export type LlmProvider = "gemini" | "anthropic" | "openai";

export interface LlmMessage {
  role: "user" | "assistant";
  text: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  /** Asks for a JSON object back. Every provider is also told so in `system`,
   *  because JSON mode is a hint on some of them and not a guarantee. */
  json?: boolean;
  maxTokens?: number;
}

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string | null;
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-5",
  openai: "gpt-4.1-mini",
};

/** The configuration, or null when this deployment has no model.
 *
 *  Null is an ordinary state and not an error: John Lau worked on keywords
 *  before a model existed and still does without one. The caller says *not
 *  configured* in a sentence rather than failing. */
export function llmConfig(): LlmConfig | null {
  if (typeof window !== "undefined") {
    throw new Error("The model key is server-only and was read in a browser.");
  }
  for (const leaked of ["NEXT_PUBLIC_ASSISTANT_LLM_API_KEY", "NEXT_PUBLIC_GEMINI_API_KEY"]) {
    if (process.env[leaked]) {
      throw new Error(
        `${leaked} is set. A model key must never carry the NEXT_PUBLIC_ prefix — that prefix `
        + "ships the value to every browser. Rename it to ASSISTANT_LLM_API_KEY and rotate the key.",
      );
    }
  }
  const raw = (process.env.ASSISTANT_LLM_PROVIDER ?? "gemini").trim().toLowerCase();
  if (raw !== "gemini" && raw !== "anthropic" && raw !== "openai") {
    throw new Error(`ASSISTANT_LLM_PROVIDER=${raw} is not one of gemini, anthropic, openai.`);
  }
  const provider = raw as LlmProvider;
  const apiKey = process.env.ASSISTANT_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    provider,
    model: process.env.ASSISTANT_LLM_MODEL?.trim() || DEFAULT_MODEL[provider],
    apiKey,
    baseUrl: process.env.ASSISTANT_LLM_BASE_URL?.trim() || null,
  };
}

/** One answer, as text. Throws with the provider's own words on failure,
 *  because *wrong key* and *model name does not exist* have different fixes. */
export async function generate(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  switch (cfg.provider) {
    case "gemini": return gemini(cfg, req);
    case "anthropic": return anthropic(cfg, req);
    case "openai": return openai(cfg, req);
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function gemini(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const out = await post(url, { "x-goog-api-key": cfg.apiKey }, {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: req.maxTokens ?? 2048,
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  }) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

async function anthropic(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  const out = await post(`${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01",
  }, {
    model: cfg.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: 0.2,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
  }) as { content?: { type: string; text?: string }[] };
  return (out.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

async function openai(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const out = await post(`${base}/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, {
    model: cfg.model,
    temperature: 0.2,
    max_tokens: req.maxTokens ?? 2048,
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.text })),
    ],
  }) as { choices?: { message?: { content?: string } }[] };
  return out.choices?.[0]?.message?.content ?? "";
}

/** The first JSON object in a model's reply.
 *
 *  JSON mode is honoured by Gemini and OpenAI and is only an instruction to
 *  Anthropic, and every one of them occasionally wraps the object in a code
 *  fence anyway. Taking the outermost braces is enough for a single object. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
