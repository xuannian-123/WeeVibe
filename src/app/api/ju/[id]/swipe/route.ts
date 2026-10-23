// 刷卡：刷完整副牌 → 入局完成
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { swipe } from "@/lib/server/intake";
import { swipeBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, swipeBody);
    return json(await swipe(id, viewerOf(req).memberToken ?? "", body.poiId, body.verdict));
  });
}
