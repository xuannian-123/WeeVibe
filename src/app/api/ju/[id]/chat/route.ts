// 私聊局长：{ text }，或组件提交 { rsvp?, location?, availability?, dietTags?, budgetMax?, schedule?, autofill? }
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { chat } from "@/lib/server/intake";
import { chatBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, chatBody);
    return json(await chat(id, viewerOf(req).memberToken ?? "", body));
  });
}
