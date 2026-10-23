// 投票：在场者过半投同一方案自动定局
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { vote } from "@/lib/server/ju";
import { voteBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, voteBody);
    return json(await vote(id, viewerOf(req).memberToken ?? "", body.proposalId, viewerOf(req)));
  });
}
