// LLM 模块对外接口（见 docs/CONTRACT.md 第四节 B1）。每个函数都有降级：无 key / 超时 / 出错 / 校验失败 → 规则结果或内置示例，绝不抛错。
// 多模态函数的 image：data URL，或字符串 "demo"（直接返回内置示例，fallback: true）。
import type { DietTag, JuSpec } from "../types";
import { callLlmJson, currentProvider } from "./provider";
import { ruleParseDiet, ruleParsePrompt } from "./rules";
import { llmDietJsonSchema, llmDietSchema, llmParseJsonSchema, llmParseSchema } from "./schemas";
import { specFromLlm, specRules } from "./spec";

export { ruleParsePrompt, ruleParseDiet, titleFromSpec } from "./rules";
export { currentProvider, visionProvider } from "./provider";

// #3 #7 #15 多模态
export { parseChatScreenshot, parseSchedule, parseReceipt, ruleReceiptTags, demoChatScreenshot, demoReceipt, DEMO_SCHEDULE } from "./multimodal";
// 私聊（看得到本人私密信息，输出只回本人）
export { chatTurn, ruleChatTurn } from "./chat";
// 公开 LLM：只接受 PublicFacts。规则版是确定性纯函数，隐私自检可以直接用
export { polishPlan, groupMessages, writeRecap, rulePolishPlan, ruleGroupMessages, ruleRecap } from "./public";

function warn(fn: string, e: unknown) {
  console.warn(`[llm] ${fn} 降级到规则：${(e as Error)?.message ?? e}`);
}

// ---------------------------------------------------------------- parsePrompt

export async function parsePrompt(
  prompt: string,
  now: Date,
  defaultCity: string,
): Promise<{ title: string; spec: JuSpec }> {
  const rule = ruleParsePrompt(prompt, now, defaultCity);
  if (currentProvider() === "rules" || !prompt.trim()) return rule;
  try {
    const system = ["你是组局助手，把用户的一句话组局需求解析成结构化 JSON。", ...specRules(now, defaultCity)].join("\n");
    const raw = await callLlmJson({ system, user: prompt, schema: llmParseJsonSchema });
    return specFromLlm(llmParseSchema.parse(raw), rule, now);
  } catch (e) {
    warn("parsePrompt", e);
    return rule;
  }
}

// ---------------------------------------------------------------- parseDiet（v1 保留，入局组件提交忌口原话时用）

const NOTHING_RE = /^(无|没有|没|都行|都可以|随便|啥都吃|什么都吃|不挑|不忌口|无忌口|没忌口|ok|no|none|-|\/)?$/i;

export async function parseDiet(raw: string): Promise<DietTag[]> {
  const text = (raw ?? "").trim();
  const rule = ruleParseDiet(text);
  // 规则已经识别出来、或明显没有忌口时，不再调 LLM（加入要快）
  if (rule.length > 0 || NOTHING_RE.test(text.replace(/[。.!！\s]/g, "")) || currentProvider() === "rules") {
    return rule;
  }
  try {
    const out = llmDietSchema.parse(
      await callLlmJson({
        system:
          "把用户的忌口描述映射到这些标签（可多选，没有就空数组）：不吃辣、素食、清真、不吃牛肉、不吃海鲜、不吃内脏。只能用这些标签。",
        user: text,
        schema: llmDietJsonSchema,
        maxTokens: 256,
      }),
    );
    return Array.from(new Set(out.tags));
  } catch (e) {
    warn("parseDiet", e);
    return rule;
  }
}
