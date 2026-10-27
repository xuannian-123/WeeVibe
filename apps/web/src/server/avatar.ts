import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { avatarUploadSchema } from '@weevibe/contracts';
import { withDb } from './db';
import { ServiceError } from './http';
const buckets = new Map<string, { count: number; expires: number }>();
function consume(actor: string) {
  const now = Date.now();
  for (const [key,value] of buckets) if(value.expires <= now) buckets.delete(key);
  const entry=buckets.get(actor);
  if ((entry && entry.count >= 5) || (!entry && buckets.size >= 10000)) throw new ServiceError('INVALID_INPUT',429,'头像更新过于频繁，请稍后再试');
  buckets.set(actor,{count:(entry?.count ?? 0)+1,expires:entry?.expires ?? now+60000});
}
/** Explicit allowlist, small input, bounded decoded pixels, re-encode without EXIF/IPTC. */
export async function normalizeAvatar(input: unknown) {
  const parsed=avatarUploadSchema.safeParse(input);
  if(!parsed.success) throw new ServiceError('INVALID_INPUT',400,'头像应为压缩后的有效图片');
  const bytes=Buffer.from(parsed.data.base64,'base64');
  if(bytes.length>42000 || bytes.toString('base64')!==parsed.data.base64) throw new ServiceError('INVALID_INPUT',400,'头像过大或编码无效');
  const jpeg=bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!jpeg && !png) throw new ServiceError('INVALID_INPUT',400,'头像仅支持 JPEG 或 PNG');
  try {
    const image=sharp(bytes,{limitInputPixels:4194304,animated:false,failOn:'warning'});
    const info=await image.metadata();
    if(!['jpeg','png'].includes(info.format ?? '') || !info.width || !info.height || info.width*info.height>4194304 || (info.pages ?? 1)!==1) throw new Error('Invalid image');
    const output=await image.rotate().resize(256,256,{fit:'cover',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:78,mozjpeg:true}).toBuffer();
    if(output.length>42000) throw new Error('Image too large');
    return { bytes:output, contentType:'image/jpeg' as const, digest:createHash('sha256').update(output).digest('hex') };
  } catch { throw new ServiceError('INVALID_INPUT',400,'图片无法安全处理，请换一张头像'); }
}
function project(row: { bytes: Uint8Array; contentType: string; digest: string; updatedAt: Date } | null) {
  return {avatar:row?{base64:Buffer.from(row.bytes).toString('base64'),content_type:'image/jpeg' as const,digest:row.digest,updated_at:row.updatedAt.toISOString()}:null};
}
export async function getAvatar(actorId:string) {return withDb(async db=>project(await db.userAvatar.findUnique({where:{userId:actorId}})));}
export async function putAvatar(actorId:string,input:unknown) {
  consume(actorId);const image=await normalizeAvatar(input);const value={...image,bytes:new Uint8Array(image.bytes)};
  return withDb(async db=>project(await db.userAvatar.upsert({where:{userId:actorId},create:{userId:actorId,...value},update:value})));
}
