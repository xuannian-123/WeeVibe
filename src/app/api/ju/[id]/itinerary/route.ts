// #11 我的行程卡（本人）
import { getItinerary } from "@/lib/server/after/actions";
import { memberTokenOf } from "@/lib/server/after/schemas";
import { handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(await getItinerary(id, memberTokenOf(req)));
  });
}
