import { clientIpOf, handle, json, readBody } from "@/lib/server/http";
import { previewParse } from "@/lib/server/ju";
import { parseBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const { prompt } = await readBody(req, parseBody);
    return json(await previewParse(prompt, clientIpOf(req)));
  });
}
