// 私信标记已读；不传 ids 就全部已读
import { readInbox } from "@/lib/server/after/actions";
import { inboxReadBody, memberTokenOf } from "@/lib/server/after/schemas";
import { handle, json, readBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const token = memberTokenOf(req);
    const { ids } = await readBody(req, inboxReadBody);
    return json(await readInbox(id, token, ids));
  });
}
