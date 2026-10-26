// #19 开始 / 下一轮：结束当前轮（写入聚合反馈），按反馈调整下一轮
import { handle, json, requireAdmin, viewerOf } from "@/lib/server/http";
import { nextRound } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await nextRound(id, viewerOf(req)));
  });
}
