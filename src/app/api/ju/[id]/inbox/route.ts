// 局长私信（本人）
import { getInbox } from "@/lib/server/after/actions";
import { memberTokenOf } from "@/lib/server/after/schemas";
import { handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(getInbox(id, memberTokenOf(req)));
  });
}
