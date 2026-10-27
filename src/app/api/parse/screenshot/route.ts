// #3 群聊截图开局：识别谁说了去 / 不去 / 在加班 → 结构化需求 + 预填成员
import { clientIpOf, handle, json, readBody } from "@/lib/server/http";
import { previewScreenshot } from "@/lib/server/ju";
import { screenshotBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const { image } = await readBody(req, screenshotBody);
    return json(await previewScreenshot(image, clientIpOf(req)));
  });
}
