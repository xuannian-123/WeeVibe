// v5 协商：回答局长私下问的是 / 否问题
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { answerAsk } from "@/lib/server/negotiate";
import { askBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, askBody);
    return json(await answerAsk(id, viewerOf(req).memberToken ?? "", body.askId, body.answer === "yes"));
  });
}
