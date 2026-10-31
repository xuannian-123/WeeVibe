// 设备级档案（#6 #10）。profileId 只有那台设备知道，公开视图里会被剥掉
// v6：PATCH = /me「分身眼中的你」里的改 / 删 / 忘掉（同样只凭 profileId）
import { HttpError, handle, json, readBody } from "@/lib/server/http";
import { editProfile, getProfile, saveProfile } from "@/lib/server/profile";
import { profileEditBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pid: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { pid } = await params;
    return json(getProfile(pid));
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { pid } = await params;
    if (pid.length < 8 || pid.length > 64) throw new HttpError(400, "档案 id 不对");
    const body = await readBody(req, profileEditBody);
    const next = editProfile(getProfile(pid), pid, body, new Date());
    saveProfile(next);
    return json(next);
  });
}
