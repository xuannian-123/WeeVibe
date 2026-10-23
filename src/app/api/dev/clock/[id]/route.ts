// 演示快进：设置演示时钟偏移后立刻巡检一次，到点的提醒马上发出
import { devClock } from "@/lib/server/after/actions";
import { adminTokenOf, clockBody } from "@/lib/server/after/schemas";
import { handle, json, readBody, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { offsetMin } = await readBody(req, clockBody);
    return json(await devClock(id, offsetMin, adminTokenOf(req)));
  });
}
