import { z } from "zod";
import type { DietTag } from "../types";

export const DIET_TAGS = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"] as const satisfies readonly DietTag[];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

/** JuSpec 的 zod 版本（API 入参校验、LLM 输出校验共用） */
export const juSpecSchema = z
  .object({
    category: z.string().trim().min(1).max(20),
    poiKeywords: z.array(z.string().trim().min(1).max(20)).min(1).max(5),
    headcount: z.number().int().min(1).max(200).optional(),
    budgetPerPerson: z.number().min(1).max(100000).optional(),
    dates: z.array(ymd).min(1).max(14),
    earliest: hhmm,
    latest: hhmm,
    durationMinutes: z.number().int().min(15).max(24 * 60),
    city: z.string().trim().min(1).max(20),
    notes: z.string().max(200).optional(),
  })
  .refine((s) => s.earliest <= s.latest, { message: "earliest 不能晚于 latest" });

const nullToUndef = <T extends z.ZodType>(t: T) => t.nullable().optional().transform((v) => v ?? undefined);

/** LLM 输出（可空字段用 null） */
export const llmParseSchema = z.object({
  title: z.string().trim().min(1).max(20),
  category: z.string().trim().min(1).max(20),
  poiKeywords: z.array(z.string().trim().min(1).max(20)).min(1).max(5),
  headcount: nullToUndef(z.number().int().min(1).max(200)),
  budgetPerPerson: nullToUndef(z.number().min(1).max(100000)),
  dates: z.array(z.string()).max(14),
  earliest: hhmm,
  latest: hhmm,
  durationMinutes: z.number().int().min(15).max(24 * 60),
  city: nullToUndef(z.string().trim().max(20)),
  notes: nullToUndef(z.string().max(200)),
});

export const llmParseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "category", "poiKeywords", "headcount", "budgetPerPerson", "dates",
    "earliest", "latest", "durationMinutes", "city", "notes",
  ],
  properties: {
    title: { type: "string", description: "短而有趣的局名，≤8 字，如“周五火锅局”" },
    category: { type: "string", description: "活动类型，如 火锅/烧烤/桌游/羽毛球/KTV" },
    poiKeywords: { type: "array", items: { type: "string" }, description: "地图搜索关键词，1-3 个" },
    headcount: { anyOf: [{ type: "integer" }, { type: "null" }] },
    budgetPerPerson: { anyOf: [{ type: "number" }, { type: "null" }], description: "人均预算上限（元）" },
    dates: { type: "array", items: { type: "string", format: "date" }, description: "候选日期 YYYY-MM-DD" },
    earliest: { type: "string", description: "最早开始 HH:mm" },
    latest: { type: "string", description: "最晚开始 HH:mm" },
    durationMinutes: { type: "integer" },
    city: { anyOf: [{ type: "string" }, { type: "null" }] },
    notes: { anyOf: [{ type: "string" }, { type: "null" }], description: "其他要求，如 包间；没有就 null" },
  },
} as const;

export const llmDietSchema = z.object({ tags: z.array(z.enum(DIET_TAGS)) });
export const llmDietJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tags"],
  properties: { tags: { type: "array", items: { type: "string", enum: [...DIET_TAGS] } } },
} as const;

export const llmBlurbSchema = z.object({ blurbs: z.array(z.string()) });
export const llmBlurbJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blurbs"],
  properties: { blurbs: { type: "array", items: { type: "string" } } },
} as const;
