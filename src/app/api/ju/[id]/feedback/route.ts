// v6 局后一键反馈（本人）：GET 看要不要问（到期时顺手发站内信），POST { verdict } 写进本人档案
import { feedbackStatus, submitFeedback } from "@/lib/server/feedback";
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { feedbackBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(await feedbackStatus(id, viewerOf(req).memberToken ?? ""));
  });
}

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, feedbackBody);
    return json(await submitFeedback(id, viewerOf(req).memberToken ?? "", body.verdict));
  });
}
