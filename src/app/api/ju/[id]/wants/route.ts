// #2 想认识谁：双方都选了才揭晓（只告诉这两个人）
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { setWants } from "@/lib/server/intake";
import { wantsBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, wantsBody);
    return json(await setWants(id, viewerOf(req).memberToken ?? "", body.memberIds));
  });
}
