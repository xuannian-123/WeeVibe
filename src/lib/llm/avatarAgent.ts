// v6 分身智能体（docs/AVATAR.md 第 4 节）：每个分身是一个独立的大模型调用，只拿得到自己主人的授权书。
// 局长（server/live-negotiation.ts）点到谁，谁说一句话；超出授权的请求，分身自己决定是私下去问主人还是直接婉拒。
// 能不能让、让多少不归分身管（授权范围内必须同意，由规则算）——分身负责的是"怎么说"和"超出授权时问不问主人"。
// 每句话公开前都过 guardAvatarSay：不准出现名字、预算数字、底线的原因、私聊原话，没过就退回规则版的说法。
import type { AvatarStyle, MandateView, Mood, NegotiationEvent } from "../types";
import { callLlmJson } from "./provider";

export type AvatarTurn =
  /** 开场：用自己的风格打个招呼，说说这次的大致状态和想要 */
  | { kind: "open" }
  /** 被点名表达一个意思（卡点 / 让步…）：intent 是规则版的那句话，分身用自己的口吻说出来 */
  | { kind: "say"; eventKind: NegotiationEvent["kind"]; intent: string }
  /** 局长请你让的超出了授权：自己决定私下问主人（ask_owner）还是替主人婉拒（decline） */
  | { kind: "ask"; request: string; floorRelated: boolean }
  /**
   * 讨论：局长摆出几个方案，你表态（支持 / 反对哪个、愿不愿意为它主动让一步）。
   * options[].mine 是这个方案对你主人怎么样（只有你知道）；respond = 第二圈，有人和你意见不同，你可以坚持或改主意
   */
  | { kind: "argue"; options: { no: number; label: string; summary: string; mine: string }[]; respond?: boolean };

export type AvatarInput = {
  code: string;
  view: MandateView;
  mood?: Mood;
  /** 到目前为止的公开谈判记录（最近几条） */
  context: NegotiationEvent[];
  turn: AvatarTurn;
};

export type AvatarOut = {
  say: string;
  action?: "ask_owner" | "decline";
  /** 讨论里支持 / 反对的方案编号（1 起） */
  support?: number;
  oppose?: number;
  /** 愿意为支持的方案在授权内主动让一步 */
  offer?: boolean;
};

const STYLE_TEXT: Record<AvatarStyle, string> = {
  easy: "随和：好说话，乐意成全大家",
  balanced: "平衡：守住要紧的，其余好商量",
  firm: "坚持：想要的会努力争取，不轻易松口",
};
const MOOD_TEXT: Record<Mood, string> = { hype: "想嗨一点", chill: "想安静聊聊", active: "想动一动", lazy: "想躺着" };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["say", "action", "support", "oppose", "offer"],
  properties: {
    say: { type: "string", description: "你在谈判群里说的一句话，≤40 字" },
    action: { type: ["string", "null"], enum: ["ask_owner", "decline", null] },
    support: { type: ["integer", "null"], description: "讨论时支持的方案编号，不是讨论填 null" },
    oppose: { type: ["integer", "null"], description: "讨论时反对的方案编号，没有填 null" },
    offer: { type: ["boolean", "null"], description: "讨论时愿不愿意为支持的方案在授权内主动让一步" },
  },
} as const;

function mandateText(v: MandateView, mood?: Mood): string {
  const g = v.give;
  const give = [
    g.lateMin ? `晚到 ${g.lateMin} 分钟以内` : "",
    g.stayCutMin ? `少待 ${g.stayCutMin} 分钟以内` : "",
    g.budgetUp ? `人均多花 ${g.budgetUp} 元以内` : "",
    g.commuteUp ? `路上多走 ${g.commuteUp} 分钟以内` : "",
  ].filter(Boolean);
  return [
    `- 底线（死守，不谈）：${v.floors.length ? v.floors.map((f) => f.text).join("；") : "没有"}`,
    `- 可以让（局长在这个范围内请你让，你必须同意）：${give.length ? give.join("、") : "一步都不让"}`,
    `- 想要（尽量争取）：${v.wants.length ? v.wants.map((w) => w.text).join("、") : "没什么特别的"}`,
    `- 这次的状态：${mood ? MOOD_TEXT[mood] : "没说"}`,
    `- 谈判风格：${STYLE_TEXT[v.style]}`,
    v.floors.length ? `- 公开时提到底线，只能说到类别：「我${floorKinds(v)}有条底线」` : "- 你没有底线：绝不能说自己有底线",
  ].join("\n");
}

/** 底线的类别（公开时只能说到这一层）："时间上" / "吃的方面" / "其他方面" */
function floorKinds(v: MandateView): string {
  const ks = new Set(v.floors.map((f) => (f.key === "homeBy" ? "时间上" : f.key.startsWith("diet:") ? "吃的方面" : "其他方面")));
  return [...ks].join("、");
}

function instruction(t: AvatarTurn): string {
  if (t.kind === "argue") {
    const opts = t.options.map((o) => `方案 ${o.no}「${o.label}」：${o.summary}\n   （只有你知道）对你主人：${o.mine}`).join("\n");
    return [
      "局长摆出了几个方案，现在是讨论时间：",
      opts,
      t.respond
        ? "有分身和你意见不一样。看看大家刚才说的，你可以坚持（说清理由、回应对方，点名用代号），也可以改支持别的方案。"
        : "结合你主人的情况和大家刚才说的，表个态：说清你支持哪个、为什么；可以回应前面的人（点名用代号）。",
      "support 填你支持的方案编号；oppose 填你反对的（没有就 null）；offer = true 表示为了你支持的方案，你愿意在授权范围内主动让一步。",
      "理由只说类别（安静、省钱、时间、离得近、好玩…），不说主人的具体数字和原因。action 填 null。",
    ].join("\n");
  }
  if (t.kind === "open")
    return "轮到你开场：从你的状态和想要里挑你最在意的一件事，用一句话说出来（类别就行，不说具体数字、不说原因）。别用「大家好」开头，像群里随口接话；没有底线就别提底线。action 填 null。";
  if (t.kind === "say") {
    const how =
      t.eventKind === "block"
        ? "局长刚摆出方案，你被卡住了"
        : t.eventKind === "concede"
          ? "局长请你让一步，这在你的授权范围内，你同意"
          : "轮到你说话";
    return `${how}。你要表达的意思是：「${t.intent}」。用你自己的风格说出来，意思不能变，数字只能用这句话里出现过的。action 填 null。`;
  }
  return [
    `局长私下请你：${t.request}`,
    "这超出了你的授权。你自己决定：ask_owner = 私下去问主人（主人答应了就算数），decline = 直接替主人婉拒。",
    t.floorRelated ? "这件事碰到了主人的底线：必须 decline。" : "一般差得不多、风格随和时倾向 ask_owner；风格坚持、或者让得太多时倾向 decline。",
    "在群里说一句话表明你的决定（不说主人的具体情况），action 填你的决定。",
  ].join("\n");
}

/** 让分身说一句话。没有大模型 / 超时 / 输出不合规时抛错，调用方退回规则版 */
export async function avatarSpeak(input: AvatarInput, timeoutMs = 9000): Promise<AvatarOut> {
  const system = [
    `你是一个 AI 分身，在一场多人聚会的谈判群里替你的主人说话。你的代号是「${input.code}」，只能用"我"自称，绝不说出主人的名字、学校、单位、住址。`,
    "你主人交给你的授权书（只有你知道，不能原样念出来）：",
    mandateText(input.view, input.mood),
    "说话规则：",
    "1. 只说一句话，≤40 字，口语，像微信群聊，最多一个表情；",
    "2. 绝不说预算的具体数字，绝不说底线背后的原因（宿舍、门禁、加班、身体、宗教、过敏、手头紧…一律不说），只说授权书里真有的事，不编；",
    "3. 可以说公开的事：几点能到、晚到几分钟、能待多久；不要编造局长没说过的方案、店名或数字；",
    "4. 语气要符合你的谈判风格。",
  ].join("\n");
  const ctx = input.context.slice(-8).map((e) => `${e.speaker}：${e.text}`).join("\n");
  const user = `${ctx ? `到目前为止的谈判群：\n${ctx}\n\n` : "谈判刚开始。\n\n"}${instruction(input.turn)}`;
  const raw = (await callLlmJson({ system, user, schema: schema as unknown as Record<string, unknown>, maxTokens: 260, timeoutMs })) as Record<string, unknown>;
  const say = typeof raw?.say === "string" ? raw.say.trim() : "";
  if (!say) throw new Error("分身没说话");
  const action = raw.action === "ask_owner" || raw.action === "decline" ? raw.action : undefined;
  if (input.turn.kind === "ask" && !action) throw new Error("分身没做决定");
  if (input.turn.kind === "argue") {
    const nos = new Set(input.turn.options.map((o) => o.no));
    const pick = (v: unknown) => (typeof v === "number" && nos.has(v) ? v : undefined);
    const support = pick(raw.support);
    if (support === undefined) throw new Error("分身没表态");
    const oppose = pick(raw.oppose);
    return { say, support, ...(oppose !== undefined && oppose !== support ? { oppose } : {}), ...(raw.offer === true ? { offer: true } : {}) };
  }
  return { say, ...(action ? { action } : {}) };
}

// ---------------------------------------------------------------- 公开前的兜底

/** 底线 / 预算背后的原因：分身一句都不能提 */
const REASON_RE = /宿舍|门禁|加班|上班|下班|公司|老板|家里|孩子|老婆|老公|女朋友|男朋友|对象|父母|爸|妈|医院|生病|身体|膝盖|腰|怀孕|过敏|清真|素食|吃素|宗教|穷|没钱|手头|工资|房租|减肥|吃土/;

export type GuardCtx = {
  /** 所有成员的真名、分身名（出现就算泄露） */
  names: string[];
  /** 私聊原话、问题原文等（防火墙的 sensitive.notes） */
  notes: string[];
  /** 允许出现的数字（规则版那句话里的 + 公开方案里的） */
  allowedNumbers: Set<number>;
};

/** 合规就返回清理过的文字，不合规返回 undefined（调用方用规则版） */
export function guardAvatarSay(text: string, g: GuardCtx): string | undefined {
  const t = text.replace(/\s+/g, " ").trim().replace(/^["“「]|["”」]$/g, "");
  if (!t || t.length > 60) return undefined;
  if (REASON_RE.test(t)) return undefined;
  if (g.names.some((n) => n.trim().length >= 2 && t.includes(n.trim()))) return undefined;
  if (g.notes.some((n) => n.trim().length >= 4 && t.includes(n.trim()))) return undefined;
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) if (!g.allowedNumbers.has(Number(m[0]))) return undefined;
  // 中文数字也算："一百五""八十块"——带百 / 千的一律不行；说到钱的话里出现任何数字都不行（预算是私密的）
  if (/[一二两三四五六七八九十][百千]|[百千][一二两三四五六七八九]?/.test(t)) return undefined;
  const plain = t.replace(/一下|一点|一步|一起|一句|一样|一定|一会|一些|一般|一直|一个人/g, "");
  if (/人均|预算|块钱|[0-9一二两三四五六七八九十]\s*[块元]|多少钱/.test(t) && /[0-9二两三四五六七八九十]/.test(plain)) return undefined;
  return t;
}
