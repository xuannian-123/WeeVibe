// v6 分身：结果公布后 30 分钟内撤回分身替你做的某次自动让步（撤回 = 这一维 give 视为 0，重算）
import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { avatarBody, revokeConcession } from "@/lib/server/negotiate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, avatarBody);
    return json(await revokeConcession(id, viewerOf(req).memberToken ?? "", body.entryId));
  });
}
