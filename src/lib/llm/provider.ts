// LLM 提供方：ANTHROPIC_API_KEY → Claude Messages API；否则 LLM_API_KEY → OpenAI 兼容；都没有 → null（走规则）。
// 只用 fetch，不装 SDK。文本调用 8 秒超时，看图调用 25 秒超时，调用方负责 catch 后降级。
// 看图：Claude 用 image content block（base64）；OpenAI 兼容用 image_url。
// 当前 provider 不支持看图（如 DeepSeek）时：有 Anthropic key 就改走 Claude，否则抛错由调用方降级到示例。

export const LLM_TIMEOUT_MS = 8000;
export const LLM_VISION_TIMEOUT_MS = 25000;
const CLAUDE_MODEL = "claude-sonnet-5-5";

export type ProviderName = "claude" | "openai-compat" | "rules";

export function currentProvider(): ProviderName {
  if ((process.env.ANTHROPIC_API_KEY ?? "").trim()) return "claude";
  if ((process.env.LLM_API_KEY ?? "").trim()) return "openai-compat";
  return "rules";
}

/** 看图专用模型（如 deepseek-flash）；设了就只有带图片的请求用它，文本仍走 LLM_MODEL */
function visionModel(): string {
  return (process.env.LLM_VISION_MODEL ?? "").trim();
}

/** OpenAI 兼容接口是否能看图：设了 LLM_VISION_MODEL，或 LLM_VISION=1 显式打开，或模型名看起来是多模态的 */
function openAiSupportsVision(): boolean {
  if (visionModel()) return true;
  const flag = (process.env.LLM_VISION ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  const model = (process.env.LLM_MODEL || "deepseek-chat").toLowerCase();
  return /vl|vision|gpt-4o|gpt-4\.1|gpt-5|gemini|qwen-?omni|glm-4v|4v/.test(model);
}

/** 看图走哪个 provider；"rules" = 没有能看图的 provider */
export function visionProvider(): ProviderName {
  if ((process.env.ANTHROPIC_API_KEY ?? "").trim()) return "claude";
  if ((process.env.LLM_API_KEY ?? "").trim() && openAiSupportsVision()) return "openai-compat";
  return "rules";
}

export type LlmRequest = {
  system: string;
  user: string;
  /** JSON Schema（Claude 结构化输出用；所有 object 都要 additionalProperties:false） */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** 图片：data URL（data:image/jpeg;base64,...）或 http(s) URL。有图片时自动选能看图的 provider，超时放宽 */
  images?: string[];
  /** 覆盖默认超时（毫秒） */
  timeoutMs?: number;
};

type ParsedImage = { kind: "base64"; mediaType: string; data: string } | { kind: "url"; url: string };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** 解析 data URL / http URL；不认识的格式抛错 */
export function parseImage(src: string): ParsedImage {
  const s = (src ?? "").trim();
  const m = s.match(/^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/);
  if (m) {
    const mediaType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
    if (!IMAGE_TYPES.includes(mediaType)) throw new Error(`不支持的图片格式 ${mediaType}`);
    if (!(m[2] ?? "").includes("base64")) throw new Error("图片 data URL 需要 base64 编码");
    const data = m[3].replace(/\s+/g, "");
    if (!data) throw new Error("图片为空");
    return { kind: "base64", mediaType, data };
  }
  if (/^https?:\/\//i.test(s)) return { kind: "url", url: s };
  throw new Error("图片应为 data URL 或 http(s) URL");
}

/** 调用 LLM，返回解析后的 JSON（未校验，调用方用 zod 校验）。无 key / 无法看图时抛错。 */
export async function callLlmJson(req: LlmRequest): Promise<unknown> {
  const hasImages = (req.images?.length ?? 0) > 0;
  const provider = hasImages ? visionProvider() : currentProvider();
  if (provider === "rules") throw new Error(hasImages ? "no vision llm" : "no llm key");
  const images = hasImages ? req.images!.map(parseImage) : [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? (hasImages ? LLM_VISION_TIMEOUT_MS : LLM_TIMEOUT_MS));
  try {
    const text =
      provider === "claude" ? await callClaude(req, images, ctrl.signal) : await callOpenAi(req, images, ctrl.signal);
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(req: LlmRequest, images: ParsedImage[], signal: AbortSignal): Promise<string> {
  const content: unknown =
    images.length === 0
      ? req.user
      : [
          ...images.map((img) =>
            img.kind === "base64"
              ? { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }
              : { type: "image", source: { type: "url", url: img.url } },
          ),
          { type: "text", text: req.user },
        ];
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
      // 简单抽取任务：低 effort，保证在超时内返回；结构化输出保证 JSON 形状
      output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
      messages: [{ role: "user", content }],
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

async function callOpenAi(req: LlmRequest, images: ParsedImage[], signal: AbortSignal): Promise<string> {
  const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = (images.length > 0 && visionModel()) || process.env.LLM_MODEL || "deepseek-chat";
  const user: unknown =
    images.length === 0
      ? req.user
      : [
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: img.kind === "base64" ? `data:${img.mediaType};base64,${img.data}` : img.url },
          })),
          { type: "text", text: req.user },
        ];
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY!.trim()}`,
    },
    body: JSON.stringify({
      model,
      // 看图模型（如 deepseek-flash）会先推理，推理 token 也算在 max_tokens 里，给小了正文会是空的
      max_tokens: images.length > 0 ? Math.max(req.maxTokens ?? 1024, 8192) : (req.maxTokens ?? 1024),
      messages: [
        {
          role: "system",
          content: `${req.system}\n\n只输出一个 JSON 对象，不要任何解释或 markdown。JSON Schema：\n${JSON.stringify(req.schema)}`,
        },
        { role: "user", content: user },
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
