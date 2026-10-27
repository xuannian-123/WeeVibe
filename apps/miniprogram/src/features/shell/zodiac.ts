// Optional common month/day ranges only, not an exact solar-position calculation.
// Range reference and cusp limitation: docs/team/profile-zodiac-suggestion.md.
const starts = [20,19,21,20,21,21,23,23,23,23,22,22] as const;
const signs = ['水瓶座','双鱼座','白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座'] as const;
export type ZodiacSuggestion = typeof signs[number];
function calendarDate(value: unknown): { month: number; day: number } | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1 || month>12 || day<1 || day>days[month-1])return;
  return {month,day};
}
/** No network, storage, personality inference, or mutation of an existing profile. */
export function zodiacSuggestion(birthday: unknown, today=new Date().toISOString().slice(0,10)): ZodiacSuggestion | undefined {
  const date=calendarDate(birthday);
  if(!date || !calendarDate(today) || (birthday as string)>today)return;
  const index=date.month-1;
  return signs[date.day>=starts[index]?index:(index+11)%12];
}
