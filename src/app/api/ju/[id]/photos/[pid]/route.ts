// #16 取照片
import { readPhoto } from "@/lib/server/after/photos";
import { handle } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; pid: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, pid } = await params;
    const { buf, mime } = readPhoto(id, pid);
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": mime, "cache-control": "private, max-age=86400" },
    });
  });
}
