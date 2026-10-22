// LLM 模块对外接口（见 docs/CONTRACT.md）。每个函数都有规则兜底：无 key / 超时 / 出错 / 校验失败 → 规则结果。
import type { DietTag, Ju, JuSpec, Member, Plan } from "../types";
import { callLlmJson, currentProvider } from "./provider";
import { charLen, BLURB_MAX, ruleBlurbs, ruleParseDiet, ruleParsePrompt } from "./rules";
import {
  juSpecSchema,
  llmBlurbJsonSchema,
  llmBlurbSchema,
  llmDietJsonSchema,
  llmDietSchema,
  llmParseJsonSchema,
  llmParseSchema,
} from "./schemas";
import { daysBetween, dowLabel, isValidYmd, shanghaiNow } from "./time";

export { ruleParsePrompt, ruleParseDiet, ruleBlurbs, titleFromSpec } from "./rules";
export { currentProvider } from "./provider";

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
    const sh = shanghaiNow(now);
    const system = [
      "你是组局助手，把用户的一句话组局需求解析成结构化 JSON。",
      `现在是北京时间 ${sh.ymd}（${dowLabel(sh.isoDow)}）${String(sh.hour).padStart(2, "0")}:${String(sh.minute).padStart(2, "0")}，一周从周一开始。`,
      "规则：",
      "- dates：按时间顺序列出所有候选日期（YYYY-MM-DD）。“周五”指最近的那个周五；“这周末”指本周六日；“下周六”指下一周的周六；没说日期就给从今天起 3 天（今天时间已过就从明天起）。",
      "- earliest / latest：最早 / 最晚开始时间 HH:mm。晚饭默认 18:00–20:00，午饭 11:30–12:30，夜宵 21:30–22:30；说了具体时间（如 8 点）就取前后 30 分钟。",
      "- durationMinutes：吃饭、运动默认 120；KTV、桌游 180；剧本杀 240。",
      "- category：简短品类（火锅/烧烤/日料/桌游/剧本杀/KTV/羽毛球/篮球/台球/咖啡…）；poiKeywords：在地图上搜场地用的词，如 [\"羽毛球馆\"]；不认识的品类就用原词。",
      `- city：句子里提到的城市，没提到就用“${defaultCity}”。`,
      "- headcount / budgetPerPerson：人数和人均预算（元），没提到给 null。",
      "- title：≤8 字、短而有趣，如“周五火锅局”“明晚撸串局”。",
    ].join("\n");
    const raw = await callLlmJson({ system, user: prompt, schema: llmParseJsonSchema });
    const out = llmParseSchema.parse(raw);

    const dates = Array.from(new Set(out.dates))
      .filter((d) => isValidYmd(d) && d >= sh.ymd && daysBetween(sh.ymd, d) <= 60)
      .sort();
    const window = out.earliest <= out.latest ? { earliest: out.earliest, latest: out.latest } : rule.spec;
    const spec: JuSpec = {
      category: out.category,
      poiKeywords: out.poiKeywords.length ? out.poiKeywords.slice(0, 3) : rule.spec.poiKeywords,
      ...(out.headcount ?? rule.spec.headcount ? { headcount: out.headcount ?? rule.spec.headcount } : {}),
      ...(out.budgetPerPerson ?? rule.spec.budgetPerPerson
        ? { budgetPerPerson: Math.round((out.budgetPerPerson ?? rule.spec.budgetPerPerson)!) }
        : {}),
      dates: dates.length ? dates : rule.spec.dates,
      earliest: window.earliest,
      latest: window.latest,
      durationMinutes: out.durationMinutes,
      city: out.city?.trim() || rule.spec.city,
      ...(out.notes?.trim() ? { notes: out.notes.trim() } : {}),
    };
    const checked = juSpecSchema.safeParse(spec);
    if (!checked.success) throw new Error(`spec 校验失败：${checked.error.issues[0]?.message}`);
    const title = charLen(out.title) <= 12 ? out.title : rule.title;
    return { title, spec: checked.data as JuSpec };
  } catch (e) {
    warn("parsePrompt", e);
    return rule;
  }
}

// ---------------------------------------------------------------- parseDiet

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

// ---------------------------------------------------------------- writeBlurbs

export async function writeBlurbs(ju: Ju, plan: Plan, members: Member[]): Promise<string[]> {
  const rule = ruleBlurbs(plan, members);
  if (currentProvider() === "rules" || plan.options.length === 0) return rule;
  try {
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "某人";
    const lines = plan.options.map((o, i) => {
      const far = [...o.commutes].sort((a, b) => b.minutes - a.minutes)[0];
      return [
        `${i + 1}. ${o.poi.name}`,
        o.poi.costPerPerson !== undefined ? `人均 ${Math.round(o.poi.costPerPerson)} 元` : "",
        o.poi.rating ? `评分 ${o.poi.rating}` : "",
        far ? `最远的是${nameOf(far.memberId)}，${Math.round(far.minutes)} 分钟` : "",
        `平均通勤 ${Math.round(o.avgCommute)} 分钟`,
        o.conflicts.length ? `忌口冲突：${o.conflicts.join("；")}` : "无忌口冲突",
        o.reasons.length ? `理由：${o.reasons.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("，");
    });
    const out = llmBlurbSchema.parse(
      await callLlmJson({
        system: [
          "你是群里那个靠谱的组局朋友。给每家候选店写一句推荐语。",
          "要求：每句 ≤26 个汉字；要有具体信息（人名、分钟数、价格、评分）；口语、自然，像在微信群里说话；不要感叹号堆砌，不要编造没给出的信息。",
          "说远近要看最长通勤：≤15 分钟才能说“近”；16–25 分钟只能说“不算远”；>25 分钟不要提“近”，只陈述分钟数或换个角度（便宜、评分高）。",
          "示例：离大家都近，最远的阿杰打车也就 15 分钟",
          `blurbs 数组按顺序输出，正好 ${plan.options.length} 句。`,
        ].join("\n"),
        user: `局：${ju.title}（${ju.spec.category}，${plan.attendeeIds.length} 人）\n候选：\n${lines.join("\n")}`,
        schema: llmBlurbJsonSchema,
        maxTokens: 512,
      }),
    );
    return plan.options.map((_, i) => {
      const b = out.blurbs[i]?.trim();
      return b && charLen(b) <= BLURB_MAX ? b : rule[i];
    });
  } catch (e) {
    warn("writeBlurbs", e);
    return rule;
  }
}
