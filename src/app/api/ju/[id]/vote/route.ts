import { handle, json, readBody } from "@/lib/server/http";
import { vote } from "@/lib/server/ju";
import { voteBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { memberId, poiId } = await readBody(req, voteBody);
    return json(await vote(id, memberId, poiId));
  });
}
