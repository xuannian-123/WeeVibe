// #11 我在路上：只共享算出来的到达时间，坐标算完即丢（不落库、不打日志）
import { postEta } from "@/lib/server/after/actions";
import { etaBody, memberTokenOf } from "@/lib/server/after/schemas";
import { handle, json, readBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const token = memberTokenOf(req);
    return json(await postEta(id, token, await readBody(req, etaBody)));
  });
}
