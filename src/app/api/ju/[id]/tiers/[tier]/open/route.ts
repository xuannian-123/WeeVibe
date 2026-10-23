// #2 开放下一圈：该圈候补的人按顺序转正（私信不提圈层）
import { HttpError, handle, json, requireAdmin, viewerOf } from "@/lib/server/http";
import { openTier } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tier: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, tier } = await params;
    requireAdmin(req, id);
    const n = Number(tier);
    if (!Number.isInteger(n) || n < 1 || n > 3) throw new HttpError(400, "圈层是 1-3");
    return json(await openTier(id, n, viewerOf(req)));
  });
}
