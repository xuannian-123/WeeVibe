// 多模态：群聊截图（#3）、课表（#7）、小票（#15）。
// image === "demo" / 没有能看图的 provider / 超时 / 输出不合法 → 返回内置示例（fallback: true），绝不抛错。
import type { BusyBlock, ChatScreenshotParse, Receipt, ReceiptItem, ReceiptItemTag, SeedMember } from "../types";
import { callLlmJson, visionProvider } from "./provider";
import { ruleParsePrompt } from "./rules";
import {
  llmReceiptJsonSchema,
  llmReceiptSchema,
  llmScheduleJsonSchema,
  llmScheduleSchema,
  llmScreenshotJsonSchema,
  llmScreenshotSchema,
  RECEIPT_TAGS,
} from "./schemas";
import { specFromLlm, specRules } from "./spec";
import { fromMinutes, toMinutes } from "./time";

function warn(fn: string, e: unknown) {
  console.warn(`[llm] ${fn} 降级到示例：${(e as Error)?.message ?? e}`);
}

const NO_FABRICATE = "不要编造截图里没有的人名、菜名或数字；看不清的就省略。";

// ================================================================ #3 群聊截图

/** 示例群聊：上海徐汇几个朋友约周六火锅，有人加班、有人不去 */
export const DEMO_CHAT_LINES: { name: string; text: string }[] = [
  { name: "小林", text: "周六晚上徐汇吃火锅冲不冲！人均一百出头那种" },
  { name: "阿杰", text: "冲，不过我周六加班到 6 点，可能要晚点到" },
  { name: "小周", text: "都行，你们定～" },
  { name: "老王", text: "周六应该可以，我晚点确认下" },
  { name: "阿May", text: "这周六去不了，你们好好吃🥲" },
  { name: "大刘", text: "看情况，我尽量" },
];

export function demoChatScreenshot(now: Date): ChatScreenshotParse {
  const { spec } = ruleParsePrompt("周六晚上在上海吃火锅，6个人，人均一百二", now, "上海");
  const seeds: ChatScreenshotParse["seeds"] = [
    { name: "小林", said: "yes", quote: DEMO_CHAT_LINES[0].text },
    { name: "阿杰", said: "yes", quote: DEMO_CHAT_LINES[1].text, hint: "周六加班到 6 点" },
    { name: "小周", said: "yes", quote: DEMO_CHAT_LINES[2].text },
    { name: "老王", said: "maybe", quote: DEMO_CHAT_LINES[3].text },
    { name: "阿May", said: "no", quote: DEMO_CHAT_LINES[4].text },
    { name: "大刘", said: "maybe", quote: DEMO_CHAT_LINES[5].text },
  ];
  return {
    title: "周六火锅局",
    spec: { ...spec, city: "上海", earliest: "18:00", latest: "19:30", notes: "徐汇附近" },
    seeds,
    fallback: true,
  };
}

const SELF_NAME_RE = /^(我|自己|本人|me)$/i;

function cleanSeeds(seeds: { name: string; said: SeedMember["said"]; quote?: string; hint?: string }[]) {
  const seen = new Set<string>();
  const out: ChatScreenshotParse["seeds"] = [];
  for (const s of seeds) {
    const name = s.name.trim();
    if (!name || SELF_NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      said: s.said,
      ...(s.quote?.trim() ? { quote: s.quote.trim().slice(0, 80) } : {}),
      ...(s.hint?.trim() ? { hint: s.hint.trim().slice(0, 30) } : {}),
    });
  }
  return out.slice(0, 20);
}

export async function parseChatScreenshot(image: string, now: Date, defaultCity: string): Promise<ChatScreenshotParse> {
  if (image === "demo" || visionProvider() === "rules") return demoChatScreenshot(now);
  try {
    const system = [
      "你是组局助手。用户发来一张微信 / QQ 群聊截图，大家在里面商量出去玩。请读懂截图，输出 JSON：",
      "1) 组局需求（title / category / poiKeywords / dates / earliest / latest / durationMinutes / city / headcount / budgetPerPerson / notes），dateText 填群里说日期的原话（如“这周六”）；",
      "2) seeds：群里每个参与讨论的人的态度。said：明确说去 = yes，明确说不去 / 去不了 = no，没表态 / 不确定 / 要确认 = maybe；quote 抄一句最能代表态度的原话；hint 只写本人在群里公开说过的时间相关信息（如“周六加班到 6 点”），没有给 null。",
      "截图右侧没有昵称的气泡是用户自己发的，name 写“我”。",
      NO_FABRICATE,
      "name 必须是截图里真实显示的昵称，原样照抄。",
      ...specRules(now, defaultCity),
    ].join("\n");
    const raw = await callLlmJson({
      system,
      user: "这是群聊截图，请解析。",
      images: [image],
      schema: llmScreenshotJsonSchema,
      maxTokens: 2048,
    });
    const out = llmScreenshotSchema.parse(raw);
    const summary = [out.dateText, out.category, out.city].filter(Boolean).join(" ");
    const rule = ruleParsePrompt(summary || out.category, now, defaultCity);
    const { title, spec } = specFromLlm(out, rule, now, out.dateText);
    return { title, spec, seeds: cleanSeeds(out.seeds) };
  } catch (e) {
    warn("parseChatScreenshot", e);
    return demoChatScreenshot(now);
  }
}

// ================================================================ #7 课表

/** 示例课表：工作日白天有课，周二周五晚上有课，周六上午辅修，周六晚上和周日空着 */
export const DEMO_SCHEDULE: BusyBlock[] = [
  { weekday: 1, from: "08:00", to: "11:30", label: "高等数学" },
  { weekday: 1, from: "13:30", to: "15:05", label: "大学英语" },
  { weekday: 2, from: "09:55", to: "11:30", label: "线性代数" },
  { weekday: 2, from: "18:30", to: "20:05", label: "电影鉴赏（选修）" },
  { weekday: 3, from: "08:00", to: "09:35", label: "大学物理" },
  { weekday: 3, from: "15:25", to: "17:00", label: "体育" },
  { weekday: 4, from: "13:30", to: "17:00", label: "物理实验" },
  { weekday: 5, from: "08:00", to: "11:30", label: "程序设计" },
  { weekday: 5, from: "18:30", to: "21:50", label: "晚自习" },
  { weekday: 6, from: "09:00", to: "12:00", label: "辅修·经济学" },
];

/** 校验 + 排序 + 去重；from >= to 的丢掉 */
export function normalizeBusy(blocks: BusyBlock[]): BusyBlock[] {
  const seen = new Set<string>();
  const out: BusyBlock[] = [];
  for (const b of blocks) {
    if (!Number.isInteger(b.weekday) || b.weekday < 1 || b.weekday > 7) continue;
    if (!/^\d{2}:\d{2}$/.test(b.from) || !/^\d{2}:\d{2}$/.test(b.to)) continue;
    if (toMinutes(b.from) >= toMinutes(b.to)) continue;
    const key = `${b.weekday}|${b.from}|${b.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      weekday: b.weekday,
      from: fromMinutes(toMinutes(b.from)),
      to: fromMinutes(toMinutes(b.to)),
      ...(b.label?.trim() ? { label: b.label.trim().slice(0, 20) } : {}),
    });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
}

export async function parseSchedule(image: string): Promise<{ busy: BusyBlock[]; fallback?: boolean }> {
  if (image === "demo" || visionProvider() === "rules") return { busy: DEMO_SCHEDULE.map((b) => ({ ...b })), fallback: true };
  try {
    const system = [
      "你在读一张大学课表截图，把每一节有课的时间段列出来（busy）。",
      "weekday：1=周一 … 7=周日。from / to：HH:mm。label：课程名。",
      "截图只写了节次没写具体时间时，按常见作息换算：第1-2节 08:00-09:35，第3-4节 09:55-11:30，第5-6节 13:30-15:05，第7-8节 15:25-17:00，第9-10节 18:30-20:05，第11-12节 20:15-21:50；连续节次合并成一段。",
      "单双周、部分周的课也算有课。空格子不要输出。",
      NO_FABRICATE,
    ].join("\n");
    const raw = await callLlmJson({
      system,
      user: "这是我的课表，请列出所有有课的时间段。",
      images: [image],
      schema: llmScheduleJsonSchema,
      maxTokens: 2048,
    });
    const out = llmScheduleSchema.parse(raw);
    return { busy: normalizeBusy(out.busy) };
  } catch (e) {
    warn("parseSchedule", e);
    return { busy: DEMO_SCHEDULE.map((b) => ({ ...b })), fallback: true };
  }
}

// ================================================================ #15 小票

const TAG_ORDER: ReceiptItemTag[] = [...RECEIPT_TAGS];

/** 规则打标签：按菜名关键词。LLM 的标签会和它取并集 */
export function ruleReceiptTags(name: string): ReceiptItemTag[] {
  const n = name.replace(/\s+/g, "");
  const tags = new Set<ReceiptItemTag>();
  const shared = /锅底|鸳鸯|锅$|米饭|白饭|小料|调料|蘸料|酱料|纸巾|湿巾|茶位|餐位|位费|餐具|开水|汤底/.test(n);
  if (shared) tags.add("shared");

  const alcohol =
    /啤酒|白酒|红酒|黄酒|清酒|烧酒|梅酒|米酒|威士忌|鸡尾酒|精酿|二锅头|茅台|五粮液|青岛|雪花|百威|科罗娜|喜力|乌苏|嘉士伯|哈尔滨|1664|(?<!料)酒(?!酿)/i.test(
      n,
    );
  if (alcohol) tags.add("alcohol");
  if (
    alcohol ||
    /饮料|饮品|可乐|雪碧|芬达|果汁|酸梅汤|豆奶|椰汁|王老吉|加多宝|矿泉水|苏打水|柠檬水|奶茶|汽水|气泡水|乌龙茶|绿茶|红茶|冰红茶|橙汁|(?<!茶位)茶$/.test(
      n,
    )
  ) {
    tags.add("drink");
  }

  // 鸳鸯锅不辣的人也能吃（有清汤那半），所以不算 spicy
  if (/麻辣|香辣|红油|辣|川味|藤椒|干锅|牛油锅/.test(n) && !/鸳鸯|不辣|免辣/.test(n)) tags.add("spicy");

  const offal = /毛肚|千层肚|牛肚|百叶|黄喉|鸭肠|鹅肠|肥肠|大肠|脑花|腰花|腰子|猪肝|鸭血|血旺|鸭胗|鸡胗|牛心|猪心/.test(n);
  if (offal) tags.add("offal");
  const beef = /肥牛|牛肉|牛舌|牛腩|牛筋|牛排|牛丸|牛肉丸|雪花牛|牛上脑|牛百叶|毛肚|千层肚|牛肚|牛心|黄喉|(?<![蜗])牛(?![油蛙奶])/.test(n);
  if (beef) tags.add("beef");
  const seafood =
    /虾|蟹|鱼(?!香)|贝|蛤|蚝|生蚝|鱿|墨鱼|章鱼|海鲜|扇贝|花甲|蛏|海参|鲍|蚌|螺|带子|海蛎|海肠/.test(n) && !/海带|鱼香/.test(n);
  if (seafood) tags.add("seafood");
  if (
    beef ||
    offal ||
    /肉|羊|鸡|鸭|鹅|猪|排骨|培根|火腿|午餐肉|香肠|肠|贡丸|肉丸|兔|蛙|鸽/.test(n.replace(/素肉|素鸡|肉松面包/g, ""))
  ) {
    if (!shared) tags.add("meat");
  }
  return TAG_ORDER.filter((t) => tags.has(t));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 规范化小票：补 id、取标签并集、金额到分；total 缺失时用明细推算 */
export function normalizeReceipt(r: {
  items: { name: string; price: number; qty: number; tags?: string[] }[];
  total?: number;
  serviceFee?: number;
  discount?: number;
  fallback?: boolean;
}): Receipt {
  const items: ReceiptItem[] = r.items
    .filter((it) => it.name.trim() && it.price >= 0 && it.qty > 0)
    .map((it, i) => {
      const llmTags = (it.tags ?? []).filter((t): t is ReceiptItemTag => (TAG_ORDER as string[]).includes(t));
      const tags = new Set<ReceiptItemTag>([...ruleReceiptTags(it.name), ...llmTags]);
      if (tags.has("alcohol")) tags.add("drink");
      return {
        id: `i${i + 1}`,
        name: it.name.trim(),
        price: round2(it.price),
        qty: Math.round(it.qty * 100) / 100,
        tags: TAG_ORDER.filter((t) => tags.has(t)),
      };
    });
  const subtotal = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const serviceFee = r.serviceFee && r.serviceFee > 0 ? round2(r.serviceFee) : undefined;
  const discount = r.discount && r.discount > 0 ? round2(r.discount) : undefined;
  const computed = round2(subtotal + (serviceFee ?? 0) - (discount ?? 0));
  const total = r.total && r.total > 0 ? round2(r.total) : Math.max(0, computed);
  return {
    items,
    total,
    ...(serviceFee ? { serviceFee } : {}),
    ...(discount ? { discount } : {}),
    ...(r.fallback ? { fallback: true } : {}),
  };
}

/** 示例火锅小票：两个锅（鸳鸯 + 麻辣）、肥牛、毛肚、虾滑、啤酒、饮料、米饭；实付 600 */
export function demoReceipt(): Receipt {
  return normalizeReceipt({
    items: [
      { name: "鸳鸯锅底", price: 58, qty: 1 },
      { name: "麻辣牛油锅底", price: 48, qty: 1 },
      { name: "精品肥牛", price: 68, qty: 2 },
      { name: "鲜毛肚", price: 58, qty: 1 },
      { name: "手打虾滑", price: 38, qty: 2 },
      { name: "时蔬拼盘", price: 36, qty: 1 },
      { name: "青岛啤酒", price: 12, qty: 6 },
      { name: "酸梅汤（扎）", price: 22, qty: 2 },
      { name: "米饭", price: 3, qty: 6 },
      { name: "小料", price: 8, qty: 6 },
    ],
    serviceFee: 30,
    discount: 24,
    total: 600,
    fallback: true,
  });
}

export async function parseReceipt(image: string): Promise<Receipt> {
  if (image === "demo" || visionProvider() === "rules") return demoReceipt();
  try {
    const system = [
      "你在读一张餐厅小票 / 结账单照片，输出每一行菜品和金额。",
      "price 是单价（元），qty 是数量；小票只给了小计时，price = 小计 / 数量。",
      "tags（可多选，没有就空数组）：alcohol=酒类；drink=饮料（酒也算）；spicy=辣的（鸳鸯锅不算）；meat=肉；beef=牛肉制品（毛肚、黄喉也算）；seafood=海鲜（虾滑、鱼丸也算）；offal=内脏；shared=大家共用的（锅底、米饭、小料、茶位费、餐具）。",
      "serviceFee：服务费 / 茶位费 / 包间费合计（茶位费按人头收的也合并到这里，不要再列成菜品）；discount：优惠 / 折扣 / 抹零合计（正数）；total：实付金额。没有就 null。",
      NO_FABRICATE,
    ].join("\n");
    const raw = await callLlmJson({
      system,
      user: "这是结账小票，请解析。",
      images: [image],
      schema: llmReceiptJsonSchema,
      maxTokens: 2048,
    });
    const out = llmReceiptSchema.parse(raw);
    if (out.items.length === 0) throw new Error("小票里没认出菜品");
    return normalizeReceipt(out);
  } catch (e) {
    warn("parseReceipt", e);
    return demoReceipt();
  }
}
