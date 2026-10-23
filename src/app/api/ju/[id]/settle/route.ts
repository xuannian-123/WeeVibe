// #14 #15 结算：私下告诉每个人该转多少，公开只给总额和已转人数
import { settleJu } from "@/lib/server/after/actions";
import { adminTokenOf, settleBody } from "@/lib/server/after/schemas";
import { handle, json, readBody, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await settleJu(id, await readBody(req, settleBody), adminTokenOf(req)));
  });
}
