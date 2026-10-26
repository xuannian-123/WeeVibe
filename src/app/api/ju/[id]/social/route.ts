// #17 #18 我和大家熟不熟 / 今天电量 / 悄悄回避 / 公开兴趣（只有兴趣会给别人看）
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { socialBody } from "@/lib/server/schemas";
import { setSocial } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, socialBody);
    return json(await setSocial(id, viewerOf(req).memberToken ?? "", body));
  });
}
