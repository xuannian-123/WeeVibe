// #18 排座一键复算：同样的输入 + 同一个密钥重跑一遍，比对 outputHash
import { handle, json } from "@/lib/server/http";
import { verifySeating } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(verifySeating(id));
  });
}
