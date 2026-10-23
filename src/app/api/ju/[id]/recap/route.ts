// #16 局后回顾 + #10 记账本
import { recap } from "@/lib/server/after/actions";
import { adminTokenOf } from "@/lib/server/after/schemas";
import { handle, json, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await recap(id, adminTokenOf(req)));
  });
}
