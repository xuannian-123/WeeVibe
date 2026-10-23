// 看图请求的形状：fetch 打桩，检查发给 Claude / OpenAI 兼容接口的请求体，不真联网。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callLlmJson, visionProvider } from "./provider";
import { parseReceipt } from "./multimodal";

const KEYS = ["ANTHROPIC_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_VISION"] as const;
let saved: Record<string, string | undefined> = {};
let bodies: { url: string; body: Record<string, unknown> }[] = [];

function stubFetch(answer: unknown) {
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    const text = JSON.stringify(answer);
    const isClaude = url.includes("anthropic");
    const payload = isClaude
      ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
      : { choices: [{ message: { content: text } }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  });
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  bodies = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };

describe("看图路由与请求体", () => {
  it("Claude：image content block（base64），文字放在图片后面", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    stubFetch({ ok: true });
    expect(await callLlmJson({ system: "s", user: "看图", images: [IMG], schema: SCHEMA })).toEqual({ ok: true });
    const { url, body } = bodies[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const content = (body.messages as { content: unknown[] }[])[0].content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
    expect(content[1]).toEqual({ type: "text", text: "看图" });
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
  });

  it("DeepSeek（不能看图）+ 有 Anthropic key → 看图改走 Claude，文本仍可走 Claude", () => {
    process.env.LLM_API_KEY = "d";
    expect(visionProvider()).toBe("rules");
    process.env.ANTHROPIC_API_KEY = "k";
    expect(visionProvider()).toBe("claude");
  });

  it("OpenAI 兼容多模态模型：image_url", async () => {
    process.env.LLM_API_KEY = "d";
    process.env.LLM_MODEL = "qwen-vl-plus";
    expect(visionProvider()).toBe("openai-compat");
    stubFetch({ ok: true });
    await callLlmJson({ system: "s", user: "看图", images: [IMG], schema: SCHEMA });
    const msgs = bodies[0].body.messages as { role: string; content: unknown }[];
    expect((msgs[1].content as unknown[])[0]).toEqual({ type: "image_url", image_url: { url: IMG } });
  });

  it("只有 DeepSeek：看图直接抛错，parseReceipt 降级到示例且不发请求", async () => {
    process.env.LLM_API_KEY = "d";
    stubFetch({ ok: true });
    await expect(callLlmJson({ system: "s", user: "u", images: [IMG], schema: SCHEMA })).rejects.toThrow("no vision llm");
    expect((await parseReceipt(IMG)).fallback).toBe(true);
    expect(bodies).toHaveLength(0);
  });

  it("parseReceipt 走 Claude：规则标签补齐 LLM 漏标的，total 缺失时按明细推算", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    stubFetch({
      items: [
        { name: "青岛啤酒", price: 12, qty: 4, tags: [] },
        { name: "麻辣锅底", price: 48, qty: 1, tags: ["shared"] },
      ],
      total: null,
      serviceFee: 10,
      discount: null,
    });
    const r = await parseReceipt(IMG);
    expect(r.fallback).toBeUndefined();
    expect(r.items[0].tags).toEqual(["alcohol", "drink"]);
    expect(r.items[1].tags).toEqual(["spicy", "shared"]);
    expect(r.total).toBe(106);
  });
});
