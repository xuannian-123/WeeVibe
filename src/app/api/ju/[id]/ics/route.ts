// 日历文件：公开视图 + 出发前提醒。?m=<memberId>（或带 x-member-token）时按他的通勤时间提醒出发
import { findByToken } from "@/lib/server/firewall";
import { handle, viewerOf } from "@/lib/server/http";
import { buildIcs, icsResponse } from "@/lib/server/ics";
import { getState, loadMembers } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const state = getState(id);
    const token = viewerOf(req).memberToken;
    const memberId =
      new URL(req.url).searchParams.get("m") || (token ? findByToken(loadMembers(id), token)?.id : undefined);
    return icsResponse(buildIcs(state, memberId ? { memberId } : {}));
  });
}
