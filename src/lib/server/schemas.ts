// API 入参 zod 校验
import { z } from "zod";
import { juSpecSchema } from "../llm/schemas";

export { juSpecSchema };

export const placeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().trim().max(100).default(""),
});

export const parseBody = z.object({ prompt: z.string().trim().min(1, "说一句话就行").max(500) });

export const createJuBody = z.object({
  prompt: z.string().trim().max(500).default(""),
  organizerName: z.string().trim().max(20).optional(),
  title: z.string().trim().min(1).max(30).optional(),
  spec: juSpecSchema.optional(),
});

const memberFields = {
  name: z.string().trim().min(1, "名字不能为空").max(20),
  avatar: z.string().trim().min(1).max(16).optional(),
  location: placeSchema,
  availableSlotIds: z.array(z.string().max(40)).max(50).default([]),
  dietRaw: z.string().max(200).default(""),
  budgetMax: z.number().min(0).max(100000).nullable().optional(),
  isOrganizer: z.boolean().optional(),
};

/** 0–3600 秒之外（或不是数字）直接丢弃，不报错 */
export const fillSecondsField = z
  .unknown()
  .optional()
  .transform((v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600 ? Math.round(v * 10) / 10 : undefined,
  );

export const addMemberBody = z.object({ ...memberFields, fillSeconds: fillSecondsField });

export const patchMemberBody = z
  .object({
    name: memberFields.name.optional(),
    avatar: memberFields.avatar,
    location: placeSchema.optional(),
    availableSlotIds: z.array(z.string().max(40)).max(50).optional(),
    dietRaw: z.string().max(200).optional(),
    budgetMax: memberFields.budgetMax,
    isOrganizer: z.boolean().optional(),
    status: z.enum(["in", "out"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有要修改的字段" });

export const voteBody = z.object({ memberId: z.string().min(1), poiId: z.string().min(1) });
export const confirmBody = z.object({ poiId: z.string().min(1) });
export const settleBody = z.object({
  total: z.number().positive("总金额要大于 0").max(1_000_000),
  payerName: z.string().trim().max(20).optional(),
});
export const seedBody = z.object({ count: z.number().int().min(1).max(8).optional() });

export type AddMemberInput = z.output<typeof addMemberBody>;
export type PatchMemberInput = z.output<typeof patchMemberBody>;
