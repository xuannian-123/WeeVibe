// LLM 解析出的组局需求 → 校验过的 JuSpec。parsePrompt（一句话）和 parseChatScreenshot（群聊截图）共用。
// 日期优先用规则从中文相对日期原话里算（确定性），算不出来再用 LLM 给的日期，再不行用规则默认值。
import type { JuSpec } from "../types";
import { charLen, detectDates } from "./rules";
import { juSpecSchema, type llmParseSchema } from "./schemas";
import { daysBetween, dowLabel, isValidYmd, pad, shanghaiNow } from "./time";
import type { z } from "zod";

export type LlmParseOut = z.output<typeof llmParseSchema>;

/** 系统提示词里共用的“现在是什么时候 + 字段规则” */
export function specRules(now: Date, defaultCity: string): string[] {
  const sh = shanghaiNow(now);
  return [
    `现在是北京时间 ${sh.ymd}（${dowLabel(sh.isoDow)}）${pad(sh.hour)}:${pad(sh.minute)}，一周从周一开始。`,
    "字段规则：",
    "- dates：按时间顺序列出所有候选日期（YYYY-MM-DD）。“周五”指最近的那个周五；“这周末”指本周六日；“下周六”指下一周的周六；没说日期就给从今天起 3 天（今天时间已过就从明天起）。",
    "- earliest / latest：最早 / 最晚开始时间 HH:mm。晚饭默认 18:00–20:00，午饭 11:30–12:30，夜宵 21:30–22:30；说了具体时间（如 8 点）就取前后 30 分钟。",
    "- durationMinutes：吃饭、运动默认 120；KTV、桌游 180；剧本杀 240。",
    "- category：简短品类（火锅/烧烤/日料/桌游/剧本杀/KTV/羽毛球/篮球/台球/咖啡…）；poiKeywords：在地图上搜场地用的词，如 [\"羽毛球馆\"]；不认识的品类就用原词。",
    `- city：提到的城市，没提到就用“${defaultCity}”。`,
    "- headcount / budgetPerPerson：人数和人均预算（元），没提到给 null。",
    "- title：≤8 字、短而有趣，如“周五火锅局”“明晚撸串局”。",
    "- notes：其他公开要求（如 包间、某个区附近），没有给 null。",
  ];
}

export function specFromLlm(
  out: LlmParseOut,
  rule: { title: string; spec: JuSpec },
  now: Date,
  dateText?: string,
): { title: string; spec: JuSpec } {
  const sh = shanghaiNow(now);
  const inRange = (d: string) => isValidYmd(d) && d >= sh.ymd && daysBetween(sh.ymd, d) <= 60;

  const fromText = dateText ? detectDates(dateText, sh)?.dates.filter(inRange) ?? [] : [];
  const fromLlm = Array.from(new Set(out.dates)).filter(inRange).sort();
  const dates = fromText.length ? fromText : fromLlm.length ? fromLlm : rule.spec.dates;

  const window = out.earliest <= out.latest ? { earliest: out.earliest, latest: out.latest } : rule.spec;
  const headcount = out.headcount ?? rule.spec.headcount;
  const budget = out.budgetPerPerson ?? rule.spec.budgetPerPerson;
  const spec: JuSpec = {
    category: out.category,
    poiKeywords: out.poiKeywords.length ? out.poiKeywords.slice(0, 3) : rule.spec.poiKeywords,
    ...(headcount ? { headcount } : {}),
    ...(budget ? { budgetPerPerson: Math.round(budget) } : {}),
    dates: dates.slice(0, 14),
    earliest: window.earliest,
    latest: window.latest,
    durationMinutes: out.durationMinutes,
    city: out.city?.trim() || rule.spec.city,
    ...(out.notes?.trim() ? { notes: out.notes.trim().slice(0, 200) } : {}),
  };
  // v6：干什么交给局长 / 候选池以规则为准（确定性）；大模型给的品类只在 v5 单品类时用
  if (rule.spec.open || rule.spec.activities?.length) {
    spec.category = rule.spec.category;
    spec.poiKeywords = rule.spec.poiKeywords;
    spec.durationMinutes = rule.spec.durationMinutes;
  }
  const checked = juSpecSchema.safeParse(spec);
  if (!checked.success) throw new Error(`spec 校验失败：${checked.error.issues[0]?.message}`);
  const v6: Pick<JuSpec, "open" | "activities"> = {
    ...(rule.spec.open ? { open: true } : {}),
    ...(rule.spec.activities?.length ? { activities: rule.spec.activities } : {}),
  };
  const title = rule.spec.open || rule.spec.activities?.length ? rule.title : charLen(out.title) <= 12 ? out.title : rule.title;
  return { title, spec: { ...(checked.data as JuSpec), ...v6 } };
}
