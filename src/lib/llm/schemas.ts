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

// ---------------------------------------------------------------- #3 群聊截图

const SAID = ["yes", "no", "maybe"] as const;

export const llmScreenshotSchema = llmParseSchema.extend({
  /** 群里说的日期原话，如 "这周六"，交给规则解析成具体日期 */
  dateText: nullToUndef(z.string().max(40)),
  seeds: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(20),
        said: z.enum(SAID),
        quote: nullToUndef(z.string().max(120)),
        hint: nullToUndef(z.string().max(60)),
      }),
    )
    .max(30),
});

export const llmScreenshotJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [...llmParseJsonSchema.required, "dateText", "seeds"],
  properties: {
    ...llmParseJsonSchema.properties,
    dateText: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "群里提到的日期原话，如“这周六”“明晚”；没提到给 null",
    },
    seeds: {
      type: "array",
      description: "群里参与讨论的每个人（发起人也算），按出现顺序",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "said", "quote", "hint"],
        properties: {
          name: { type: "string", description: "截图里显示的昵称，原样照抄" },
          said: { type: "string", enum: [...SAID], description: "yes=说了去 / no=说不去 / maybe=没表态或不确定" },
          quote: { anyOf: [{ type: "string" }, { type: "null" }], description: "最能代表态度的一句原话" },
          hint: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "跟时间安排有关的提示，如“周六加班到 6 点”；没有给 null",
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------- #7 课表

export const llmScheduleSchema = z.object({
  busy: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        from: hhmm,
        to: hhmm,
        label: nullToUndef(z.string().max(30)),
      }),
    )
    .max(80),
});

export const llmScheduleJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["busy"],
  properties: {
    busy: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["weekday", "from", "to", "label"],
        properties: {
          weekday: { type: "integer", description: "1=周一 … 7=周日" },
          from: { type: "string", description: "开始 HH:mm" },
          to: { type: "string", description: "结束 HH:mm" },
          label: { anyOf: [{ type: "string" }, { type: "null" }], description: "课程名" },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------- #15 小票

export const RECEIPT_TAGS = ["alcohol", "spicy", "meat", "beef", "seafood", "offal", "drink", "shared"] as const;

export const llmReceiptSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        price: z.number().min(0).max(100000),
        qty: z.number().min(0.01).max(1000),
        tags: z.array(z.string()),
      }),
    )
    .max(80),
  total: nullToUndef(z.number().min(0).max(1000000)),
  serviceFee: nullToUndef(z.number().min(0).max(100000)),
  discount: nullToUndef(z.number().min(0).max(100000)),
});

export const llmReceiptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "serviceFee", "discount"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "price", "qty", "tags"],
        properties: {
          name: { type: "string", description: "菜名，原样照抄" },
          price: { type: "number", description: "单价（元）" },
          qty: { type: "number", description: "数量" },
          tags: { type: "array", items: { type: "string", enum: [...RECEIPT_TAGS] } },
        },
      },
    },
    total: { anyOf: [{ type: "number" }, { type: "null" }], description: "实付总额" },
    serviceFee: { anyOf: [{ type: "number" }, { type: "null" }], description: "服务费 / 茶位费 / 包间费合计" },
    discount: { anyOf: [{ type: "number" }, { type: "null" }], description: "优惠 / 折扣 / 抹零合计（正数）" },
  },
} as const;

// ---------------------------------------------------------------- 私聊

export const NEED_DIMS = ["time", "travel", "money", "food", "activity", "ambience", "people", "body", "join"] as const;
export const NEED_TYPES = ["maxCommute", "leaveBy", "avoidCategory", "preferCategory", "quiet", "noAlcohol", "indoor", "lightFood", "noQueue", "custom"] as const;

/** 大模型抽出的一条需求（扁平，方便结构化输出），由 chat.ts 的 toNeed 校验后转成 NeedRule */
export const llmNeedSchema = z.object({
  dim: z.enum(NEED_DIMS),
  kind: z.enum(["hard", "soft"]),
  strength: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  type: z.enum(NEED_TYPES),
  minutes: z.number().min(5).max(240).nullable().optional(),
  at: hhmm.nullable().optional(),
  words: z.array(z.string().trim().min(1).max(8)).max(6).nullable().optional(),
  text: z.string().trim().min(1).max(40),
});

const CHAT_ASKS = ["rsvp", "location", "time", "diet", "budget", "notes", "swipe"] as const;

export const llmChatSchema = z.object({
  reply: z.string().trim().min(1).max(200),
  /** 这条回复最后问的是哪一项；没有提问（只回答对方的问题 / 收尾）为 null */
  askStep: nullToUndef(z.enum(CHAT_ASKS)),
  rsvp: nullToUndef(z.enum(["yes", "no"])),
  placeName: nullToUndef(z.string().trim().max(30)),
  /** 用户说的时间安排：每个候选日期一条 */
  availability: nullToUndef(
    // 模型偶尔按日期给成对象 { "2030-11-01": {...} }：转成数组再校验，不让整轮作废
    z.preprocess(
      (v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.entries(v as Record<string, object>).map(([date, a]) => ({ date, ...(a && typeof a === "object" ? a : {}) }))
          : v,
      z.array(
        z.object({
          date: ymd,
          // 模型偶尔给 null / 非法时间：这一条丢掉，不让整轮回复作废（mergePatch 里过滤）
          from: hhmm.nullable().optional().catch(undefined),
          homeBy: hhmm.nullable().optional().catch(undefined),
          pref: z.enum(["best", "ok", "meh"]).catch("ok"),
        }),
      ),
    ),
  ),
  dietTags: nullToUndef(z.array(z.enum(DIET_TAGS))),
  budgetMax: nullToUndef(z.number().min(10).max(5000)),
  note: nullToUndef(z.string().trim().max(80)),
  noAlcohol: nullToUndef(z.boolean()),
  skipItems: nullToUndef(z.array(z.string().trim().min(1).max(12)).max(10)),
  wantsAutofill: nullToUndef(z.boolean()),
  /** v5：能算的其他需求（单条不合法就丢掉这一条，不让整轮作废） */
  needs: nullToUndef(z.array(llmNeedSchema.nullable().catch(null)).max(8)),
  /** v5：预算有多在意（手头紧 = 3） */
  budgetStrength: nullToUndef(z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(2)),
});

const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });

export const llmChatJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply", "askStep", "rsvp", "placeName", "availability", "dietTags", "budgetMax", "note", "noAlcohol", "skipItems",
    "wantsAutofill", "needs", "budgetStrength",
  ],
  properties: {
    reply: { type: "string", description: "局长的回复，1-3 句，≤80 字" },
    askStep: nullable({ type: "string", enum: [...CHAT_ASKS], description: "这条回复最后问的是清单里哪一项" }),
    rsvp: nullable({ type: "string", enum: ["yes", "no"] }),
    placeName: nullable({ type: "string", description: "用户说的出发地点名，如“漕河泾”" }),
    availability: nullable({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "from", "homeBy", "pref"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD，只能是候选日期之一" },
          from: { type: "string", description: "最早能出发 HH:mm" },
          homeBy: nullable({ type: "string", description: "几点前要回到出发地 HH:mm" }),
          pref: { type: "string", enum: ["best", "ok", "meh"] },
        },
      },
    }),
    dietTags: nullable({ type: "array", items: { type: "string", enum: [...DIET_TAGS] } }),
    budgetMax: nullable({ type: "number", description: "人均上限（元）" }),
    note: nullable({ type: "string", description: "其他想让局长知道的约束摘要" }),
    noAlcohol: nullable({ type: "boolean", description: "明确说了不喝酒 / 开车" }),
    skipItems: nullable({ type: "array", items: { type: "string" }, description: "明确说了不吃的菜" }),
    wantsAutofill: nullable({ type: "boolean", description: "说了“都行 / 随便 / 你定”" }),
    needs: nullable({
      type: "array",
      description: "对方这句话里新说的、时间 / 预算数字 / 忌口之外的需求",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dim", "kind", "strength", "type", "minutes", "at", "words", "text"],
        properties: {
          dim: { type: "string", enum: [...NEED_DIMS] },
          kind: { type: "string", enum: ["hard", "soft"], description: "hard 只用于对方明确说了必须 / 绝对 / 最多 / 不然就不去" },
          strength: { type: "integer", enum: [1, 2, 3], description: "1 随口一提 / 2 在意 / 3 很在意" },
          type: { type: "string", enum: [...NEED_TYPES] },
          minutes: nullable({ type: "number", description: "maxCommute 的分钟数" }),
          at: nullable({ type: "string", description: "leaveBy 的时刻 HH:mm" }),
          words: nullable({ type: "array", items: { type: "string" }, description: "avoidCategory / preferCategory 的品类词，如 火锅、KTV" }),
          text: { type: "string", description: "局长复述这条需求的一句话，≤20 字，如“单程尽量别超过 30 分钟”" },
        },
      },
    }),
    budgetStrength: nullable({ type: "integer", enum: [1, 2, 3], description: "预算有多在意：手头紧 = 3，无所谓 = 1" }),
  },
} as const;

// ---------------------------------------------------------------- 公开文案

export const llmPolishSchema = z.object({
  blurbs: z.array(z.string()),
  recommendation: z.string().trim().min(1).max(160),
});
export const llmPolishJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blurbs", "recommendation"],
  properties: {
    blurbs: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
  },
} as const;

export const llmGroupSchema = z.object({
  broadcast: z.string().trim().min(1).max(600),
  reservationScript: nullToUndef(z.string().trim().max(400)),
  reservationDialog: nullToUndef(
    z
      .array(z.object({ who: z.enum(["局长", "店员"]), text: z.string().trim().min(1).max(120) }))
      .min(6)
      .max(10),
  ),
});
export const llmGroupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["broadcast", "reservationScript", "reservationDialog"],
  properties: {
    broadcast: { type: "string" },
    reservationScript: nullable({ type: "string" }),
    reservationDialog: nullable({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["who", "text"],
        properties: { who: { type: "string", enum: ["局长", "店员"] }, text: { type: "string" } },
      },
    }),
  },
} as const;

export const llmRecapSchema = z.object({ recap: z.string().trim().min(1).max(240) });
export const llmRecapJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recap"],
  properties: { recap: { type: "string" } },
} as const;
