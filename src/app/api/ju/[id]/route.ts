import { tickJu } from "@/lib/server/after/scheduler";
import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { getStateFull, patchJu } from "@/lib/server/ju";
import { patchJuBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 公开视图；带 x-member-token 附 me / mine，带 x-admin-token 附 ju.admin。每次先懒执行一遍到点的事 */
export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    try {
      await tickJu(id);
    } catch (e) {
      console.warn(`[api] tickJu(${id}) 失败：${(e as Error)?.message ?? e}`);
    }
    return json(await getStateFull(id, viewerOf(req)));
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await patchJu(id, await readBody(req, patchJuBody), viewerOf(req)));
  });
}
