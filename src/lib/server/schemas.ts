// API 入参 zod 校验
import { z } from "zod";
import { juSpecSchema } from "../llm/schemas";
import { GIVE_MAX, MAX_FLOORS, ONBOARD_FLOORS } from "../client/mandate";

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

// ---- v6 分身：授权书 / 建档 / 档案 / 反馈 ----
const MOODS = ["hype", "chill", "active", "lazy"] as const;
const STYLES = ["easy", "balanced", "firm"] as const;
const TRANSPORTS = ["metro", "drive", "taxi", "bike", "walk"] as const;
const activityKey = z.string().regex(/^[a-z]{2,20}$/, "活动 key 不对");

export const giveSchema = z.object({
  lateMin: z.number().int().min(0).max(GIVE_MAX.lateMin),
  stayCutMin: z.number().int().min(0).max(GIVE_MAX.stayCutMin),
  budgetUp: z.number().int().min(0).max(GIVE_MAX.budgetUp),
  commuteUp: z.number().int().min(0).max(GIVE_MAX.commuteUp),
});

const mandateInput = z.object({
  style: z.enum(STYLES),
  give: giveSchema.optional(),
  /** 底线 key，最多 3 条 */
  floors: z.array(z.string().min(1).max(40)).max(MAX_FLOORS, `底线最多 ${MAX_FLOORS} 条：底线越少，分身越好谈`).default([]),
});

const profilePlace = z.object({ kind: z.enum(["home", "work", "school", "other"]), place: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().trim().max(100).default("") }) });

export const onboardingBody = z.object({
  avatarName: z.string().trim().max(12).optional(),
  places: z.array(profilePlace).max(4).optional(),
  transport: z.enum(TRANSPORTS).optional(),
  transports: z.array(z.enum(TRANSPORTS)).max(5).optional(),
  floors: z.array(z.enum(ONBOARD_FLOORS)).max(MAX_FLOORS, `底线最多 ${MAX_FLOORS} 条：底线越少，分身越好谈`).optional(),
  /** 自己写的底线（和上面的加起来最多 3 条） */
  customFloors: z.array(z.string().trim().min(1).max(40)).max(MAX_FLOORS).optional(),
  homeBy: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式 HH:mm").optional(),
  allergy: z.string().trim().max(20).optional(),
  /** 选了"路程上限"时最多几分钟 */
  commuteMax: z.number().int().min(5).max(180).optional(),
  budget: z.number().min(0).max(100000).optional(),
  swipes: z.record(activityKey, z.enum(["love", "like", "pass"])).optional(),
}).refine((v) => (v.floors?.length ?? 0) + (v.customFloors?.length ?? 0) <= MAX_FLOORS, { message: `底线最多 ${MAX_FLOORS} 条：底线越少，分身越好谈` });

export const profileEditBody = z
  .object({
    avatarName: z.string().trim().max(12).nullable().optional(),
    style: z.enum(STYLES).nullable().optional(),
    places: z.array(profilePlace).max(4).nullable().optional(),
    transport: z.enum(TRANSPORTS).nullable().optional(),
    transports: z.array(z.enum(TRANSPORTS)).max(5).optional(),
    /** 自己写的底线（整组替换） */
    customFloors: z.array(z.string().trim().min(1).max(40)).max(MAX_FLOORS).optional(),
    usualHomeBy: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式 HH:mm").nullable().optional(),
    dietTags: z.array(z.enum(["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"])).max(6).optional(),
    body: z.array(z.string().trim().min(1).max(20)).max(5).optional(),
    typicalBudget: z.number().min(0).max(100000).nullable().optional(),
    activityTastes: z.record(activityKey, z.number().min(-1).max(1)).optional(),
    forget: z.array(z.string().min(1).max(60)).max(50).optional(),
    forgetLearned: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "没有要修改的字段" });

export const feedbackBody = z.object({ verdict: z.enum(["great", "tired", "pricey", "far", "loud", "ok"]) });

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
    preferenceAction: z.enum(["review", "finish", "swipe"]).optional(),
    preferencesChat: z.literal(true).optional(),
    // ---- v6 授权书卡片（docs/AVATAR.md 5.2），全部是私密字段 ----
    mood: z.enum(MOODS).nullable().optional(),
    activityOpen: z.boolean().optional(),
    /** 想干什么（活动 key，完整选择：没出现的 = 取消） */
    activities: z.array(activityKey).max(6).optional(),
    /** 讲究标签（CARE_TAGS 的 key，完整选择） */
    tags: z.array(z.string().min(1).max(20)).max(12).optional(),
    mandate: mandateInput.optional(),
    /** 首次建档（写进本人档案，并按新档案重新预填这次的卡片） */
    onboarding: onboardingBody.optional(),
    /** 授权书上自己写一条：hard = 底线，soft = 想要 */
    addNeed: z.object({ text: z.string().trim().min(1).max(40), kind: z.enum(["hard", "soft"]) }).optional(),
    /** 删掉自己写的一条（need id） */
    removeNeed: z.string().min(1).max(60).optional(),
    /** 想干什么里自己写的活动（"陶艺""猫咖"） */
    customActivity: z.string().trim().min(1).max(12).optional(),
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

// ---- v4 局内编排 ----
const familiarity = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const memberIdField = z.string().min(1).max(40);

export const socialBody = z
  .object({
    know: z.record(memberIdField, familiarity).optional(),
    energy: z.enum(["low", "mid", "high"]).optional(),
    avoid: z.array(memberIdField).max(1).optional(),
    interests: z.array(z.string().trim().min(1).max(20)).max(8).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "没有要修改的字段" });

export const feelBody = z.object({ round: z.number().int().min(0).max(10), feel: z.enum(["stiff", "ok", "loud"]) });
export const clickedBody = z.object({ memberIds: z.array(memberIdField).max(50) });
export const seatingBody = z.object({
  rounds: z.number().int().min(1).max(3).optional(),
  tableSize: z.number().int().min(2).max(8).optional(),
});
export const seatAbsentBody = z.object({ memberId: memberIdField, absent: z.boolean() });

export const voteBody = z.object({ proposalId: z.string().min(1).max(200) });
export const confirmBody = z.object({ proposalId: z.string().min(1).max(200) });
export const seedBody = z.object({
  count: z.number().int().min(1).max(12).optional(),
  /** club = v4 社团团建场景（9 个半生不熟的演示成员 + 前两局的圈子历史） */
  /** avatar = v6 分身谈判场景（8 个分身，一键出方案看完整五轮谈判） */
  scene: z.enum(["default", "club", "conflict", "avatar"]).optional(),
});

export type CreateJuInput = z.output<typeof createJuBody>;
export type PatchJuInput = z.output<typeof patchJuBody>;
export type JoinInput = z.output<typeof joinBody>;
export type ChatBody = z.output<typeof chatBody>;
export type PatchMemberInput = z.output<typeof patchMemberBody>;

// ---- v5 协商 ----
export const askBody = z.object({ askId: z.string().min(1).max(20), answer: z.enum(["yes", "no"]) });
export type ProfileEditInput = z.output<typeof profileEditBody>;
export type OnboardingBody = z.output<typeof onboardingBody>;
