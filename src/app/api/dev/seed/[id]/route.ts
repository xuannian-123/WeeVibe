import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { seedBody } from "@/lib/server/schemas";
import { seedAvatar, seedClub, seedConflict, seedJu } from "@/lib/server/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 演示场景（CONTRACT 第八节）；scene = "club" 是 v4 社团团建场景（第十节）；"avatar" 是 v6 分身谈判场景 */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { count, scene } = await readBody(req, seedBody);
    if (scene === "avatar") return json(await seedAvatar(id, viewerOf(req)));
    if (scene === "club") return json(await seedClub(id, viewerOf(req)));
    if (scene === "conflict") return json(await seedConflict(id, viewerOf(req)));
    return json(await seedJu(id, Math.min(count ?? 6, 6), viewerOf(req)));
  });
}
