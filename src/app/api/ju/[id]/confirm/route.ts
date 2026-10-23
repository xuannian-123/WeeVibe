import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { confirm } from "@/lib/server/ju";
import { confirmBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 发起人拍板 */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { proposalId } = await readBody(req, confirmBody);
    return json(await confirm(id, proposalId, viewerOf(req)));
  });
}
