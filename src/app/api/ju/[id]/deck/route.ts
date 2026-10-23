// 刷卡牌堆（5-6 张，确定性）；有局长预填时附"局长猜你"（#6）
import { handle, json, viewerOf } from "@/lib/server/http";
import { deckFor } from "@/lib/server/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(await deckFor(id, viewerOf(req).memberToken ?? ""));
  });
}
