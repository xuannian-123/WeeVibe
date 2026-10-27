import { describe,expect,it,vi } from 'vitest';
import sharp from '../apps/web/node_modules/sharp';
import { normalizeAvatar } from '../apps/web/src/server/avatar';
import { avatarUploadSchema } from '../packages/contracts/src/avatar';
describe('safe avatar normalization',()=>{
 it('re-encodes a small image, strips metadata and produces bounded JPEG',async()=>{const input=await sharp({create:{width:100,height:80,channels:3,background:'#f0cfc4'}}).withMetadata({exif:{IFD0:{Artist:'PRIVATE-EXIF'}}}).jpeg().toBuffer();const result=await normalizeAvatar({base64:input.toString('base64')});const meta=await sharp(result.bytes).metadata();expect(result.contentType).toBe('image/jpeg');expect(result.digest).toMatch(/^[0-9a-f]{64}$/);expect(meta.exif).toBeUndefined();expect(meta.width).toBeLessThanOrEqual(256);expect(result.bytes.length).toBeLessThan(42000);});
 it('accepts real PNG and flattens to JPEG',async()=>{const bytes=await sharp({create:{width:32,height:32,channels:4,background:{r:10,g:20,b:30,alpha:0.5}}}).png().toBuffer();expect((await normalizeAvatar({base64:bytes.toString('base64')})).contentType).toBe('image/jpeg');});
 it.each(['<svg xmlns="http://www.w3.org/2000/svg"></svg>','<html>bad</html>','not image'])('rejects non-raster payload',async text=>expect(normalizeAvatar({base64:Buffer.from(text).toString('base64')})).rejects.toMatchObject({code:'INVALID_INPUT'}));
 it('rejects oversized or noncanonical base64',async()=>{await expect(normalizeAvatar({base64:'A'.repeat(56004)})).rejects.toMatchObject({code:'INVALID_INPUT'});await expect(normalizeAvatar({base64:'AAAA\n'})).rejects.toMatchObject({code:'INVALID_INPUT'});});
 it('rejects forged ownership or arbitrary image URL',()=>{expect(avatarUploadSchema.safeParse({base64:'AAAA',user_id:'other'}).success).toBe(false);expect(avatarUploadSchema.safeParse({url:'https://evil.example'}).success).toBe(false);});
 it('rejects a malformed image even with JPEG magic',async()=>expect(normalizeAvatar({base64:Buffer.from([255,216,255,0,0,0]).toString('base64')})).rejects.toMatchObject({code:'INVALID_INPUT'}));
 it('rejects compressed images with excessive decoded pixels',async()=>{const huge=await sharp({create:{width:3000,height:3000,channels:3,background:'#ffffff'}}).png().toBuffer();await expect(normalizeAvatar({base64:huge.toString('base64')})).rejects.toMatchObject({code:'INVALID_INPUT'});});
});
