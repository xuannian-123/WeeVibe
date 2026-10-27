import { describe, expect, it } from 'vitest';
import sharp from '../apps/web/node_modules/sharp';
import { parsePrivateProfile } from '../apps/web/src/server/account-rules';
import { normalizeCover, publicProfile } from '../apps/web/src/server/member-profile';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('member profile opt-in projection', () => {
  it('keeps legacy private information and new expressions private by default', () => {
    const profile = parsePrivateProfile({ nickname: '朋友', birthday: '2000-01-01', signature: 'PRIVATE_SIGNATURE', introduction: 'PRIVATE_DESCRIPTION', bio: 'PRIVATE_BIO', interests: ['徒步'], mbti: 'INFP', zodiac: '天秤座' });
    const result = publicProfile(profile, actor);
    expect(result).toMatchObject({ user_id: actor, nickname: '朋友', cover_style: 'mint', avatar: null, cover_image: null });
    for (const field of ['birthday', 'signature', 'introduction', 'bio', 'interests', 'mbti', 'zodiac']) expect(result).not.toHaveProperty(field);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it('projects only independently opted-in fields', () => {
    const profile = parsePrivateProfile({ bio: '一起出门', interests: ['徒步', '摄影'], mbti: 'INFP', zodiac: '天秤座', visibility: { bio: true, interests: true, mbti: false, zodiac: false } });
    const result = publicProfile(profile, actor);expect(result.bio).toBe('一起出门');expect(result.interests).toEqual(['徒步','摄影']);expect(result).not.toHaveProperty('mbti');expect(result).not.toHaveProperty('zodiac');
  });
  it('rejects duplicate/excessive interest tags and invalid privacy flags', () => {
    expect(() => parsePrivateProfile({ interests: ['徒步','徒步'] })).toThrow();
    expect(() => parsePrivateProfile({ interests: Array.from({length:7},(_,i)=>String(i)) })).toThrow();
    expect(() => parsePrivateProfile({ visibility: { bio: 'yes' } })).toThrow();
  });
});
describe('profile covers', () => {
  it('normalizes a real PNG to a bounded JPEG without embedded metadata', async () => {
    const input = await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#e4f4eb' } }).withMetadata().png().toBuffer();
    const result = await normalizeCover(input.toString('base64'));const bytes=Buffer.from(result.base64,'base64');const image=await sharp(bytes).metadata();
    expect(image.format).toBe('jpeg');expect(image.width).toBeLessThanOrEqual(720);expect(image.height).toBeLessThanOrEqual(300);expect(image.exif).toBeUndefined();expect(bytes.length).toBeLessThanOrEqual(42000);
  });
  it('rejects remote URLs, SVG, malformed base64 and oversized payloads', async () => {
    for (const value of ['https://example.test/image.jpg',Buffer.from('<svg/>').toString('base64'),'AAA','A'.repeat(56004)]) await expect(normalizeCover(value)).rejects.toMatchObject({ code:'INVALID_INPUT' });
  });
});
