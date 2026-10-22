// LLM 提供方：ANTHROPIC_API_KEY → Claude Messages API；否则 LLM_API_KEY → OpenAI 兼容；都没有 → null（走规则）。
// 只用 fetch，不装 SDK。所有调用 8 秒超时，调用方负责 catch 后降级。

export const LLM_TIMEOUT_MS = 8000;
const CLAUDE_MODEL = "claude-sonnet-5-5";

export type ProviderName = "claude" | "openai-compat" | "rules";

export function currentProvider(): ProviderName {
  if ((process.env.ANTHROPIC_API_KEY ?? "").trim()) return "claude";
  if ((process.env.LLM_API_KEY ?? "").trim()) return "openai-compat";
  return "rules";
}

export type LlmRequest = {
  system: string;
  user: string;
  /** JSON Schema（Claude 结构化输出用；所有 object 都要 additionalProperties:false） */
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/** 调用 LLM，返回解析后的 JSON（未校验，调用方用 zod 校验）。无 key 时抛错。 */
export async function callLlmJson(req: LlmRequest): Promise<unknown> {
  const provider = currentProvider();
  if (provider === "rules") throw new Error("no llm key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const text = provider === "claude" ? await callClaude(req, ctrl.signal) : await callOpenAi(req, ctrl.signal);
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(req: LlmRequest, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
      "anthropic-version": "2026-10-21",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      // 简单抽取任务：低 effort，保证 8 秒内返回；结构化输出保证 JSON 形状
      output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
      messages: [{ role: "user", content: req.user }],
    }),
  });
  if (!res.ok) throw new Error(`claude http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };
  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    throw new Error(`claude stop_reason ${data.stop_reason}`);
  }
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text) throw new Error("claude empty response");
  return text;
}

async function callOpenAi(req: LlmRequest, signal: AbortSignal): Promise<string> {
  const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "deepseek-chat";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY!.trim()}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [
        {
          role: "system",
          content: `${req.system}\n\n只输出一个 JSON 对象，不要任何解释或 markdown。JSON Schema：\n${JSON.stringify(req.schema)}`,
        },
        { role: "user", content: req.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("llm empty response");
  return text;
}

/** 容忍 ```json 代码块、前后废话 */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error("llm output is not json");
  }
}
