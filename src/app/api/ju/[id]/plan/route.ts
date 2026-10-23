import { handle, json, requireAdmin, viewerOf } from "@/lib/server/http";
import { makePlan } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 出方案 / 重算（没完成入局的人由局长预填） */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await makePlan(id, viewerOf(req)));
  });
}
