// #19 这一轮感觉怎么样（私下说，只以聚合数字出现）
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { feelBody } from "@/lib/server/schemas";
import { setFeel } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, feelBody);
    return json(await setFeel(id, viewerOf(req).memberToken ?? "", body.round, body.feel));
  });
}
