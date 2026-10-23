// 入局：认领截图里的自己（seedId）/ 分层邀请（tierToken）/ 名额满或该圈未开放 → 候补
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { join } from "@/lib/server/intake";
import { joinBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, joinBody);
    return json(await join(id, body, viewerOf(req)), 201);
  });
}
