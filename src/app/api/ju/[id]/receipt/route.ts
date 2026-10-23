// #15 拍小票 → 分账预览（只给发起人）
import { receipt } from "@/lib/server/after/actions";
import { imageBody } from "@/lib/server/after/schemas";
import { handle, json, readBody, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { image } = await readBody(req, imageBody);
    return json(await receipt(id, image));
  });
}
