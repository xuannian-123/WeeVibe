// API 入参 zod 校验
import { z } from "zod";
import { juSpecSchema } from "../llm/schemas";

export { juSpecSchema };

const DIET_TAGS = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"] as const;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const placeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().trim().max(100).default(""),
});

/** 图片：data URL（前端压到长边 ≤ 1600px 的 JPEG），或 "demo" 用内置示例 */
export const imageSchema = z
  .string()
  .max(8_000_000, "图片太大了，压缩一下再传")
  .refine((s) => s === "demo" || /^data:image\/[a-z+.-]+;base64,/i.test(s), "图片需要是 data URL，或 \"demo\"");

const isoTime = z.string().refine((s) => Number.isFinite(Date.parse(s)), "需要 ISO 时间");

export const parseBody = z.object({ prompt: z.string().trim().min(1, "说一句话就行").max(500) });
export const screenshotBody = z.object({ image: imageSchema });

const seedInput = z.object({
  name: z.string().trim().min(1).max(20),
  said: z.enum(["yes", "no", "maybe"]),
  quote: z.string().trim().max(200).optional(),
  hint: z.string().trim().max(100).optional(),
});

export const createJuBody = z.object({
  prompt: z.string().trim().max(500).default(""),
  organizerName: z.string().trim().max(20).optional(),
  title: z.string().trim().min(1).max(30).optional(),
  spec: juSpecSchema.optional(),
  deadline: isoTime.optional(),
  quorum: z.object({ min: z.number().int().min(2).max(50), deadline: isoTime.optional() }).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  tiers: z.number().int().min(1).max(3).optional(),
  seeds: z.array(seedInput).max(30).optional(),
});

export const patchJuBody = z
  .object({
    deadline: isoTime.nullable().optional(),
    title: z.string().trim().min(1).max(30).optional(),
    capacity: z.number().int().min(1).max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

/** 0–3600 秒之外（或不是数字）直接丢弃，不报错 */
export const fillSecondsField = z
  .unknown()
  .optional()
  .transform((v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600 ? Math.round(v * 10) / 10 : undefined,
  );

export const joinBody = z.object({
  name: z.string().trim().max(20).default(""),
  avatar: z.string().trim().min(1).max(16).optional(),
  profileId: z.string().trim().min(8).max(64).optional(),
  isOrganizer: z.boolean().optional(),
  tierToken: z.string().trim().min(1).max(64).optional(),
  seedId: z.string().trim().min(1).max(20).optional(),
});

const dayAvailability = z.object({
  from: z.string().regex(HM, "时间格式 HH:mm"),
  homeBy: z.string().regex(HM, "时间格式 HH:mm").optional(),
  pref: z.enum(["best", "ok", "meh"]).default("ok"),
});

export const chatBody = z
  .object({
    text: z.string().trim().max(500).optional(),
    rsvp: z.enum(["yes", "no"]).optional(),
    location: placeSchema.optional(),
    availability: z.record(z.string().regex(YMD), dayAvailability).optional(),
    dietTags: z.array(z.enum(DIET_TAGS)).max(6).optional(),
    budgetMax: z.number().positive().max(100000).optional(),
    schedule: imageSchema.optional(),
    autofill: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined && x !== ""), { message: "说点什么吧" });

export const swipeBody = z.object({ poiId: z.string().min(1).max(100), verdict: z.enum(["love", "like", "pass"]) });
export const wantsBody = z.object({ memberIds: z.array(z.string().min(1).max(40)).max(50) });

export const patchMemberBody = z
  .object({
    status: z.enum(["in", "out"]).optional(),
    role: z.enum(["guest", "must"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

export const voteBody = z.object({ proposalId: z.string().min(1).max(200) });
export const confirmBody = z.object({ proposalId: z.string().min(1).max(200) });
export const seedBody = z.object({ count: z.number().int().min(1).max(6).optional() });

export type CreateJuInput = z.output<typeof createJuBody>;
export type PatchJuInput = z.output<typeof patchJuBody>;
export type JoinInput = z.output<typeof joinBody>;
export type ChatBody = z.output<typeof chatBody>;
export type PatchMemberInput = z.output<typeof patchMemberBody>;
