import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { z } from "zod";
import { seedBody } from "@/lib/server/schemas";
import { seedAvatar, seedClub, seedConflict, seedJu } from "@/lib/server/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** v6：scene = "avatar" 是分身谈判演示（8 个分身，一键出方案看完整五轮谈判） */
const body = seedBody.extend({ scene: z.enum(["default", "club", "conflict", "avatar"]).optional() });

/** 演示场景（CONTRACT 第八节）；scene = "club" 是 v4 社团团建场景（第十节） */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { count, scene } = await readBody(req, body);
    if (scene === "avatar") return json(await seedAvatar(id, viewerOf(req)));
    if (scene === "club") return json(await seedClub(id, viewerOf(req)));
    if (scene === "conflict") return json(await seedConflict(id, viewerOf(req)));
    return json(await seedJu(id, Math.min(count ?? 6, 6), viewerOf(req)));
  });
}
