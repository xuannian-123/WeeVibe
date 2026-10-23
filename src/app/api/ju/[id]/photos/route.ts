// #16 上传局后照片（在局里的人）
import { imageBody, memberTokenOf } from "@/lib/server/after/schemas";
import { savePhoto } from "@/lib/server/after/photos";
import { HttpError, handle, json, readBody } from "@/lib/server/http";
import { memberByToken } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const me = memberByToken(id, memberTokenOf(req));
    if (me.status !== "in") throw new HttpError(403, "只有在局里的人能传照片");
    const { image } = await readBody(req, imageBody);
    return json(await savePhoto(id, image));
  });
}
