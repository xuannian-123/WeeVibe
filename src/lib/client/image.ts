// 图片压缩：长边压到 maxEdge 以内，转 JPEG data URL（后端 / 多模态只收这个，或字符串 "demo"）

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55];
/** data URL 上限，约 2.4MB 原图；超过就降质量 */
const MAX_DATA_URL = 3_200_000;

type Drawable = { src: CanvasImageSource; width: number; height: number; close?: () => void };

async function decode(file: Blob): Promise<Drawable> {
  // 优先 createImageBitmap：会按 EXIF 方向摆正手机照片
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* 老浏览器不认 options，落到 <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("这张图片打不开，换一张试试（HEIC 可以先截个屏）"));
      el.src = url;
    });
    return { src: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    // onload 之后图像已解码进内存，可以释放
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 把用户选的图片压成 JPEG data URL。
 * @param file   <input type="file"> 拿到的文件
 * @param maxEdge 长边上限，默认 1600px（契约第五节）
 */
export async function compressImage(file: File, maxEdge = 1600): Promise<string> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) {
    throw new Error("请选一张图片");
  }
  const img = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持图片处理，换个浏览器试试");
    // JPEG 没有透明通道：先铺白底，截图里的透明区域不会变黑
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.src, 0, 0, w, h);
    let out = "";
    for (const q of QUALITY_STEPS) {
      out = canvas.toDataURL("image/jpeg", q);
      if (out.length <= MAX_DATA_URL) break;
    }
    return out;
  } finally {
    img.close?.();
  }
}

/** 选图小工具：触发一个临时 <input type=file>，返回压缩后的 data URL；用户取消返回 null */
export function pickImage(opts: { capture?: boolean; maxEdge?: number } = {}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (opts.capture) input.setAttribute("capture", "environment");
    input.style.display = "none";
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      try {
        resolve(await compressImage(f, opts.maxEdge));
      } catch (e) {
        reject(e);
      }
    };
    document.body.appendChild(input);
    input.click();
  });
}
