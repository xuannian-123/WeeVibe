// #18 现场有人没到 / 又到了：重排还没开始的轮次
import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { seatAbsentBody } from "@/lib/server/schemas";
import { seatAbsent } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const body = await readBody(req, seatAbsentBody);
    return json(await seatAbsent(id, body.memberId, body.absent, viewerOf(req)));
  });
}
