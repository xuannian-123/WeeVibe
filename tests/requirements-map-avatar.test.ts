import { describe, expect, it } from 'vitest';
import { mapRequirementLocation, editRequirementLocation } from '../apps/miniprogram/src/features/requirements/location-state';
import { validatePublicOrganizerAvatar, publicAvatarFileName } from '../apps/miniprogram/src/features/requirements/public-avatar';
const venue={name:'测试场地（离线fixture）',address:'测试地址',location:{longitude:121.4737,latitude:31.2304,crs:'GCJ-02'},source:{provider:'amap',checked_at:'2030-01-01T00:00:00Z',source_api:'https://restapi.amap.com/v5/place/text'}};
describe('requirement map candidate provenance',()=>{
 it('preserves schema-validated map coordinates and source',()=>{const candidate=mapRequirementLocation('location-1',venue);expect(candidate.label).toBe(venue.name);expect(candidate.venue).toEqual(venue);});
 it('manual label edits discard old coordinates and source instead of relabeling a POI',()=>expect(editRequirementLocation(mapRequirementLocation('location-1',venue),'新自定义地点')).toEqual({id:'location-1',label:'新自定义地点'}));
 it('rejects invalid or swapped coordinates',()=>expect(()=>mapRequirementLocation('location-1',{...venue,location:{...venue.location,latitude:121.47,longitude:31.23}})).toThrow());
 it('rejects arbitrary/non-provider provenance',()=>expect(()=>mapRequirementLocation('location-1',{...venue,source:{...venue.source,provider:'invented'}})).toThrow());
});
describe('explicit public organizer avatar boundary',()=>{
 const asset={base64:'/9j/AA==',content_type:'image/jpeg',digest:'a'.repeat(64),updated_at:'2030-01-01T00:00:00Z'};
 it('accepts bounded explicitly projected JPEG assets',()=>expect(validatePublicOrganizerAvatar(asset)).toEqual(asset));
 it('does not read a private profile or accept an arbitrary remote URL',()=>{expect(validatePublicOrganizerAvatar({private_profile:{avatar:asset}})).toBeNull();expect(validatePublicOrganizerAvatar('https://example.com/private.jpg')).toBeNull();});
 it('rejects oversized bytes and invalid digest',()=>{expect(validatePublicOrganizerAvatar({...asset,base64:'/9j/'+ 'A'.repeat(56000)})).toBeNull();expect(validatePublicOrganizerAvatar({...asset,digest:'../../private'})).toBeNull();});
 it('uses only a fixed public prefix and digest for local filenames',()=>expect(publicAvatarFileName(asset as never)).toBe(`weevibe-public-organizer-${'a'.repeat(64)}.jpg`));
});
