// 中文数字 → 数字：八 / 十二 / 一百 / 一百五 / 两百 / 1百 都行

const DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 仨: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

export const CN_NUM_CLASS = "零〇一二两俩三仨四五六七八九十百千万";
export const NUM_RE_SRC = `(?:\\d+(?:\\.\\d+)?|[${CN_NUM_CLASS}]+)`;

export function parseCnNumber(s: string): number | undefined {
  s = s.trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let total = 0;
  let section = 0;
  let digit = -1;
  let lastUnit = 0;
  let sawZero = false;
  for (const ch of s) {
    if (ch in DIGIT) {
      digit = DIGIT[ch];
      if (digit === 0) sawZero = true;
    } else if (ch in UNIT) {
      const u = UNIT[ch];
      const d = digit < 0 ? 1 : digit;
      if (u === 10000) {
        total += (section + (digit < 0 ? 0 : digit)) * u;
        section = 0;
      } else {
        section += d * u;
      }
      lastUnit = u;
      digit = -1;
    } else {
      return undefined;
    }
  }
  if (digit >= 0) {
    // 口语：一百五 = 150、两千三 = 2300
    if (lastUnit >= 100 && !sawZero && s.length >= 3) section += digit * (lastUnit / 10);
    else section += digit;
  }
  return total + section;
}
