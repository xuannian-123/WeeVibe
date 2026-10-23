// 设备级档案（#6 #10）。profileId 只有那台设备知道，公开视图里会被剥掉
import { handle, json } from "@/lib/server/http";
import { getProfile } from "@/lib/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pid: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { pid } = await params;
    return json(getProfile(pid));
  });
}
