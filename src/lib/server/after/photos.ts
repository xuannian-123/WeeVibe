// #16 局后照片：data URL 解码后存 data/photos/<juId>/<nanoid>.<ext>，GET 原样返回。
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import * as db from "../../db";
import { HttpError } from "../http";
import { loadJu, nowFor, withJuLock } from "../ju";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** 每个局最多存多少张 */
export const PHOTO_MAX_COUNT = 60;

const TYPES = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
} as const;
type Kind = keyof typeof TYPES;
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function photosRoot(): string {
  return process.env.JUZHANG_PHOTOS_DIR || path.join(process.cwd(), "data", "photos");
}

function juDir(juId: string): string {
  if (!ID_RE.test(juId)) throw new HttpError(400, "局 id 不合法");
  return path.join(photosRoot(), juId);
}

export const photoUrl = (juId: string, pid: string) => `/api/ju/${juId}/photos/${pid}`;

/** 看文件头确认真的是这种图片（防止把别的东西改个 MIME 塞进来） */
function sniff(buf: Buffer): Kind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** 解析并校验 data URL：只收 jpeg / png / webp，解码后 ≤ 5MB */
export function decodePhoto(image: string): { kind: Kind; buf: Buffer } {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(image);
  if (!m) throw new HttpError(415, "只支持 JPEG / PNG / WebP 图片（data URL）");
  // 先按 base64 长度粗估，避免把超大串整个解码
  if (Math.floor((m[2].length * 3) / 4) > PHOTO_MAX_BYTES + 16) throw new HttpError(413, "照片太大了，最多 5MB");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0) throw new HttpError(400, "图片是空的");
  if (buf.length > PHOTO_MAX_BYTES) throw new HttpError(413, "照片太大了，最多 5MB");
  const declared: Kind = m[1] === "jpg" ? "jpeg" : (m[1] as Kind);
  const real = sniff(buf);
  if (!real || real !== declared) throw new HttpError(415, "图片内容和格式对不上，只支持 JPEG / PNG / WebP");
  return { kind: real, buf };
}

/** 局里已有的照片 url，按上传先后 */
export function listPhotos(juId: string): string[] {
  const dir = juDir(juId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t || a.f.localeCompare(b.f))
    .map(({ f }) => photoUrl(juId, f.replace(/\.[a-z]+$/, "")));
}

export function savePhoto(juId: string, image: string): Promise<{ url: string }> {
  loadJu(juId);
  const { kind, buf } = decodePhoto(image);
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const dir = juDir(juId);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).length >= PHOTO_MAX_COUNT) throw new HttpError(409, `这个局最多 ${PHOTO_MAX_COUNT} 张照片`);
    const pid = nanoid(12);
    fs.writeFileSync(path.join(dir, `${pid}.${TYPES[kind].ext}`), buf);
    const url = photoUrl(juId, pid);
    // 照片墙实时更新：回顾还没写也先把照片挂上（text 为空 = 回顾还没生成）
    if (ju.recap) ju.recap.photos.push(url);
    else ju.recap = { text: "", photos: [url], at: nowFor(ju).toISOString() };
    db.saveJu(ju);
    return { url };
  });
}

export function readPhoto(juId: string, pid: string): { buf: Buffer; mime: string } {
  if (!ID_RE.test(pid)) throw new HttpError(404, "照片不存在");
  const dir = juDir(juId);
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const f = path.join(dir, `${pid}.${ext}`);
    if (fs.existsSync(f)) return { buf: fs.readFileSync(f), mime: MIME_BY_EXT[ext] };
  }
  throw new HttpError(404, "照片不存在");
}
