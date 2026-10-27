import { describe, expect, it } from 'vitest';
import { zodiacSuggestion } from '../apps/miniprogram/src/features/shell/zodiac';
import { parsePrivateProfile } from '../apps/web/src/server/account-rules';
const today='2030-06-01';
const boundaries=[
 ['01',20,'摩羯座','水瓶座'],['02',19,'水瓶座','双鱼座'],['03',21,'双鱼座','白羊座'],
 ['04',20,'白羊座','金牛座'],['05',21,'金牛座','双子座'],['06',21,'双子座','巨蟹座'],
 ['07',23,'巨蟹座','狮子座'],['08',23,'狮子座','处女座'],['09',23,'处女座','天秤座'],
 ['10',23,'天秤座','天蝎座'],['11',22,'天蝎座','射手座'],['12',22,'射手座','摩羯座'],
] as const;
describe('local common-date zodiac suggestions, not astronomical/personality predictions',()=>{
 for(const [month,start,previous,next] of boundaries){
  it(`${month} day before boundary preserves ${previous}`,()=>expect(zodiacSuggestion(`2000-${month}-${start-1}`,today)).toBe(previous));
  it(`${month} boundary begins ${next}`,()=>expect(zodiacSuggestion(`2000-${month}-${start}`,today)).toBe(next));
  it(`${month} next day remains ${next}`,()=>expect(zodiacSuggestion(`2000-${month}-${start+1}`,today)).toBe(next));
 }
 it.each(['2000-02-29','2024-02-29'])('accepts a real leap day %s',date=>expect(zodiacSuggestion(date,today)).toBe('双鱼座'));
 it.each(['1900-02-29','2023-02-29','2000-02-30','2000-04-31','2000-06-31','2000-09-31','2000-11-31','2000-00-01','2000-13-01','2000-01-00','2000-01-32','2000-1-01',' 2000-01-01','2000-01-01 ','2000-01-01T00:00:00Z','not-a-date','','2030-06-02','9999-12-31'])('does not suggest for missing/malformed/future date %s',date=>expect(zodiacSuggestion(date,today)).toBeUndefined());
 it.each([null,undefined,1,false,{},[],{toString(){throw new Error('must not coerce private object');}}].map(input=>({input})))('does not coerce a non-string input %#',({input})=>expect(zodiacSuggestion(input,today)).toBeUndefined());
 it('supports year ends and does not shift dates to the runtime timezone',()=>{expect(zodiacSuggestion('2000-01-01',today)).toBe('摩羯座');expect(zodiacSuggestion('2000-12-31',today)).toBe('摩羯座');expect(zodiacSuggestion(today,today)).toBe('双子座');});
 it('fails closed when the comparison calendar date is invalid',()=>{expect(zodiacSuggestion('2000-01-01','bad')).toBeUndefined();expect(zodiacSuggestion('2000-01-01','2030-02-30')).toBeUndefined();});
 it('returns only values accepted by the unchanged server profile contract for every day in a leap year',()=>{let count=0;for(let d=new Date('2000-01-01T00:00:00Z');d.getUTCFullYear()===2000;d.setUTCDate(d.getUTCDate()+1)){const birthday=d.toISOString().slice(0,10);const zodiac=zodiacSuggestion(birthday,today);expect(zodiac).toBeTruthy();expect(parsePrivateProfile({birthday,zodiac},new Date(today)).zodiac).toBe(zodiac);count++;}expect(count).toBe(366);});
});
