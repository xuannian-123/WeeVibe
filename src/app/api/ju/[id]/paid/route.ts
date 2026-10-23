// #14 本人标记"我已转"
import { markPaid } from "@/lib/server/after/actions";
import { memberTokenOf } from "@/lib/server/after/schemas";
import { handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(await markPaid(id, memberTokenOf(req)));
  });
}
