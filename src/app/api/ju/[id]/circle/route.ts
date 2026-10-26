// #21 同一个圈子一局一局熟起来（顺着「再约」链，全是聚合数字）
import { handle, json } from "@/lib/server/http";
import { circle } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(circle(id));
  });
}
