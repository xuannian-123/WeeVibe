// #20 局后：和谁聊得来。双方都选了才揭晓（只告诉这两个人）
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { clickedBody } from "@/lib/server/schemas";
import { setClicked } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, clickedBody);
    return json(await setClicked(id, viewerOf(req).memberToken ?? "", body.memberIds));
  });
}
