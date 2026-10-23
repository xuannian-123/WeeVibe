// B3 路由的入参 zod 校验 + 取 token 的小工具
import { z } from "zod";
import { HttpError } from "../http";

/** 取 x-member-token；缺失直接 401 */
export function memberTokenOf(req: Request): string {
  const t = req.headers.get("x-member-token")?.trim();
  if (!t) throw new HttpError(401, "需要成员身份（x-member-token）");
  return t;
}

export const adminTokenOf = (req: Request) => req.headers.get("x-admin-token") ?? "";

export const etaBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  from: z.literal("wgs84").optional(),
});

export const inboxReadBody = z.object({ ids: z.array(z.string().max(80)).max(100).optional() });

export const reservationBody = z.object({
  status: z.enum(["none", "scripted", "called", "booked"]).optional(),
  tableSize: z.number().int().min(1).max(100).optional(),
});

/** data URL 或 "demo"；照片 5MB → base64 约 6.7MB，留点余量 */
export const imageBody = z.object({ image: z.string().min(1, "缺少图片").max(8_000_000, "图片太大了") });

export const settleBody = z.object({
  total: z.number().positive("总金额要大于 0").max(1_000_000).optional(),
  payerName: z.string().trim().max(20).optional(),
  useReceipt: z.boolean().optional(),
});

export const againBody = z.object({ prompt: z.string().trim().max(500).optional() });

export const clockBody = z.object({ offsetMin: z.number().int().min(-60 * 24 * 7).max(60 * 24 * 30) });
