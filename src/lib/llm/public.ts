// 公开 LLM（隐私防火墙第三层）：方案润色、群公告 / 催促 / 订位话术 / 模拟通话、局后回顾。
// 硬规则：这里的函数只接受 PublicFacts（+ Plan 里本来就公开的字段），类型上拿不到任何 Member 私密字段。
// 规则版是确定性的纯函数（隐私交换检验会用到），LLM 版的输出要过“数字 / 人名”校验，不过就用规则版。
import type { GroupMessages, Plan, PublicFacts } from "../types";
import { callLlmJson, currentProvider } from "./provider";
import { BLURB_MAX, charLen, fit } from "./rules";
import {
  llmGroupJsonSchema,
  llmGroupSchema,
  llmPolishJsonSchema,
  llmPolishSchema,
  llmRecapJsonSchema,
  llmRecapSchema,
} from "./schemas";

function warn(fn: string, e: unknown) {
  console.warn(`[llm] ${fn} 降级到规则：${(e as Error)?.message ?? e}`);
}

const PUBLIC_RULES = [
  "硬性要求：",
  "- 只能使用下面给出的事实，不要编造任何人名、店名、菜品、价格或数字；",
  "- 不要提及任何个人约束的细节（谁的预算、谁几点要回、谁不吃什么、谁没来、谁没转账），约束只能用给出的聚合说法；",
  "- 约束只能原样引用给出的聚合说法（如“有人不吃辣”），不要说“那位 / 这位 / 某位 / 他 / 她”这类指向具体某个人的话；",
  "- 不要点名批评任何人。",
].join("\n");

/** 指向具体某个人的说法（“不吃辣的那位”）：LLM 写出来就退回规则版 */
const SINGLE_OUT_RE = /那位|这位|某位|那个人|这个人|那一位|(?<!其)[他她]/;

/** LLM 公开文案的统一校验：数字有出处、不指向具体某个人 */
function publicSafe(text: string, factsText: string): boolean {
  return numbersGrounded(text, factsText) && !SINGLE_OUT_RE.test(text);
}

/** 文本里出现的所有数字（阿拉伯数字） */
function numbersIn(s: string): string[] {
  return Array.from(s.matchAll(/\d+(?:\.\d+)?/g), (m) => String(Number(m[0])));
}

/** LLM 写的文案里的数字必须都在事实里出现过（≤10 的小数字放行，如“3 个方案”） */
export function numbersGrounded(text: string, factsText: string): boolean {
  const allowed = new Set(numbersIn(factsText));
  return numbersIn(text).every((n) => Number(n) <= 10 || allowed.has(n));
}

// ================================================================ polishPlan

function ruleBlurb(p: Plan["proposals"][number]): string {
  const cost = p.poi.costPerPerson;
  const parts = [p.highlights[0], p.headline, cost !== undefined ? `人均${Math.round(cost)}` : "", p.highlights[1]];
  return fit(parts.filter((x): x is string => !!x));
}

/** 规则版：blurb 用亮点 / 一句话概括拼；recommendation 原样保留 */
export function rulePolishPlan(facts: PublicFacts, plan: Plan): Plan {
  void facts;
  return {
    ...plan,
    proposals: plan.proposals.map((p) => ({ ...p, blurb: p.blurb ?? ruleBlurb(p) })),
  };
}

export async function polishPlan(facts: PublicFacts, plan: Plan): Promise<Plan> {
  const rule = rulePolishPlan(facts, plan);
  if (currentProvider() === "rules" || plan.proposals.length === 0) return rule;
  try {
    const lines = plan.proposals.map((p, i) =>
      [
        `${i + 1}. 【${p.labelText}】${p.poi.name}`,
        p.poi.costPerPerson !== undefined ? `人均 ${Math.round(p.poi.costPerPerson)} 元` : "",
        p.poi.rating ? `评分 ${p.poi.rating}` : "",
        `${p.attendCount} 人能到`,
        `概括：${p.headline}`,
        p.highlights.length ? `亮点：${p.highlights.join("；")}` : "",
        p.tradeoffs.length ? `取舍：${p.tradeoffs.join("；")}` : "",
        p.recommended ? "（局长推荐）" : "",
      ]
        .filter(Boolean)
        .join("，"),
    );
    const factsText = [
      lines.join("\n"),
      plan.recommendation,
      plan.caredFor ?? "",
      plan.constraintSummaries.join("；"),
    ].join("\n");
    const out = llmPolishSchema.parse(
      await callLlmJson({
        system: [
          "你是群里那个靠谱的组局朋友“局长”。局长已经用算法定好了方案，你只负责把文字写得自然好读。",
          `1) blurbs：给每个方案写一句推荐语（≤${BLURB_MAX - 6} 个汉字），说清楚“为什么可以选它”，带上给出的具体数字；口语、像微信群里说话；不要罗列缺点。按顺序输出，正好 ${plan.proposals.length} 句。`,
          "2) recommendation：把局长的推荐理由润色成 1–2 句话（≤80 字），意思不能变，不能改推荐哪一个。",
          PUBLIC_RULES,
        ].join("\n"),
        user: `局：${facts.title}（${facts.category}，${facts.city}）\n方案：\n${lines.join("\n")}\n\n局长的推荐理由：${plan.recommendation}${plan.caredFor ? `\n照顾说明：${plan.caredFor}` : ""}${plan.constraintSummaries.length ? `\n大家的约束（聚合）：${plan.constraintSummaries.join("；")}` : ""}`,
        schema: llmPolishJsonSchema,
        maxTokens: 700,
      }),
    );
    const recommendation =
      charLen(out.recommendation) <= 120 && publicSafe(out.recommendation, factsText)
        ? out.recommendation
        : plan.recommendation;
    // 只改文字：方案集合、顺序、数字原样保留
    return {
      ...plan,
      recommendation,
      proposals: plan.proposals.map((p, i) => {
        const b = out.blurbs[i]?.trim();
        const ok = b && charLen(b) <= BLURB_MAX && publicSafe(b, factsText);
        return { ...p, blurb: ok ? b : rule.proposals[i].blurb };
      }),
    };
  } catch (e) {
    warn("polishPlan", e);
    return rule;
  }
}

// ================================================================ groupMessages

type Phase = "collecting" | "voting" | "confirmed" | "settling" | "cancelled";

function phaseOf(facts: PublicFacts): Phase {
  if (facts.status === "cancelled") return "cancelled";
  if (facts.status === "confirmed") return facts.settlement ? "settling" : "confirmed";
  return facts.status;
}

/** 订位时要跟店家提的公开需求（只从聚合约束推出来，不涉及任何人） */
function publicNeeds(facts: PublicFacts): string[] {
  const needs: string[] = [];
  const all = facts.constraintSummaries.join("；");
  const hotpot = /火锅|串串|冒菜/.test(facts.category);
  if (hotpot && /辣/.test(all)) needs.push("锅底要鸳鸯锅");
  else if (/辣/.test(all)) needs.push("有几道不辣的菜");
  if (/素/.test(all)) needs.push("有素食选择");
  if (/清真/.test(all)) needs.push("需要清真");
  if (/海鲜/.test(all)) needs.push("有人不吃海鲜");
  if (/包间|安静/.test(all)) needs.push("尽量安排包间或安静的位置");
  return needs;
}

function nudgeText(name: string, facts: PublicFacts, phase: Phase): string {
  if (phase === "voting") return `@${name} 方案出来啦，点链接看看你的体验，投一票就行～`;
  return `@${name} 就差你啦～点链接跟局长聊 1 分钟，预算、几点要回这些悄悄说就行，只有局长知道。`;
}

function proposalLine(p: NonNullable<PublicFacts["proposals"]>[number], i: number): string {
  const cost = p.costPerPerson !== undefined ? `（人均 ${Math.round(p.costPerPerson)}）` : "";
  return `${String.fromCharCode(65 + i)}. ${p.labelText} · ${p.slotLabel} · ${p.poiName}${cost} — ${p.headline}`;
}

function ruleDialog(facts: PublicFacts): { who: "局长" | "店员"; text: string }[] {
  const c = facts.confirmed!;
  const needs = publicNeeds(facts);
  return [
    { who: "店员", text: `您好，${c.poiName}，请问有什么可以帮您？` },
    { who: "局长", text: `您好，我想订个位，${c.slotLabel}，${c.headcount} 位。` },
    { who: "店员", text: `${c.slotLabel} ${c.headcount} 位是吧，我查一下……有位置的。` },
    {
      who: "局长",
      text: needs.length ? `好的，麻烦${needs.join("，")}。` : "好的，麻烦安排一张能坐下所有人的桌子。",
    },
    { who: "店员", text: needs.length ? "没问题，我给您备注上。" : "好的，给您安排一张大桌。" },
    { who: "局长", text: "我们可能有人会晚到十几分钟，位子能帮忙留一下吗？" },
    { who: "店员", text: "可以的，帮您保留 15 分钟。请问怎么称呼？" },
    { who: "局长", text: `留${facts.organizerName ? `${facts.organizerName}的名字` : "“局长”"}就行，到店报“${facts.title}”。谢谢！` },
  ];
}

function ruleScript(facts: PublicFacts): string {
  const c = facts.confirmed!;
  const needs = publicNeeds(facts);
  return [
    `您好，想订 ${c.slotLabel}，${c.headcount} 位。`,
    needs.length ? `${needs.join("，")}。` : "",
    "可能有人会晚到十几分钟，麻烦帮忙留一下位。",
    facts.organizerName ? `订位人：${facts.organizerName}。` : "",
  ]
    .filter(Boolean)
    .join("");
}

/** 规则版：确定性，只用 facts */
export function ruleGroupMessages(facts: PublicFacts): GroupMessages {
  const phase = phaseOf(facts);
  const c = facts.counts;
  const pending = facts.members.filter((m) => m.intake !== "done" && !m.isOrganizer);
  const nudges =
    phase === "collecting" || phase === "voting"
      ? pending.map((m) => ({ memberId: m.id, name: m.name, text: nudgeText(m.name, facts, phase) }))
      : [];

  if (phase === "cancelled") {
    return { broadcast: `【${facts.title}】这次没凑成，局长先收摊啦。下次有空再约～`, nudges: [] };
  }

  if (phase === "collecting") {
    const lines = [`【${facts.title}】局长在收集大家的情况～`];
    if (c.quorumNeed) {
      lines.push(
        `已经有 ${c.quorumHave ?? 0}/${c.quorumNeed} 人私下说了来，凑够 ${c.quorumNeed} 人就成局；谁说了什么，局长都不会说。`,
      );
    } else {
      lines.push(`已有 ${c.in} 人入局，${c.done} 人跟局长聊完了。`);
    }
    if (c.matchPairs > 0) lines.push(`已经有 ${c.matchPairs} 对朋友互相想认识，局长会安排坐一起。`);
    lines.push("还没填的朋友点链接跟局长聊 1 分钟。不方便在群里说的（预算、几点要回、忌口），私下告诉局长就行，只有局长知道。");
    return { broadcast: lines.join("\n"), nudges };
  }

  if (phase === "voting") {
    const props = facts.proposals ?? [];
    const lines = [`【${facts.title}】局长出了 ${props.length} 个方案：`, ...props.map(proposalLine)];
    const rec = props.findIndex((p) => p.recommended);
    if (facts.recommendation) lines.push(`局长推荐${rec >= 0 ? ` ${String.fromCharCode(65 + rec)}` : ""}：${facts.recommendation}`);
    if (facts.caredFor) lines.push(facts.caredFor);
    if (facts.constraintSummaries.length) lines.push(facts.constraintSummaries.join("；"));
    lines.push("点链接投一票，过半就定；方案可复核，同样的输入一定算出同样的结果。");
    return { broadcast: lines.join("\n"), nudges };
  }

  if (phase === "settling") {
    const s = facts.settlement!;
    const lines = [
      `【${facts.title}】结账啦：一共 ${formatMoney(s.total)} 元，已转 ${s.paidCount}/${s.payCount}。`,
      ...s.explain,
      "每个人该转多少局长已经私下发给你了，还没转的局长会私下提醒，群里不点名～",
    ];
    return { broadcast: lines.join("\n"), nudges: [] };
  }

  // confirmed
  const cf = facts.confirmed;
  if (!cf) return { broadcast: `【${facts.title}】定局啦！详情点链接看。`, nudges: [] };
  const lines = [
    `【${facts.title}】定了！`,
    `时间：${cf.slotLabel}`,
    `地点：${cf.poiName}（${cf.address}）`,
    `人数：${cf.headcount} 人`,
  ];
  if (facts.revisions?.length) lines.push(`更新：${facts.revisions[facts.revisions.length - 1]}`);
  lines.push("每个人的出发时间和路线局长已经私下发你了，到点会提醒。");
  return {
    broadcast: lines.join("\n"),
    nudges: [],
    reservationScript: ruleScript(facts),
    reservationDialog: ruleDialog(facts),
  };
}

function formatMoney(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

export async function groupMessages(facts: PublicFacts): Promise<GroupMessages> {
  const rule = ruleGroupMessages(facts);
  if (currentProvider() === "rules") return rule;
  const phase = phaseOf(facts);
  try {
    const factsText = JSON.stringify(facts);
    const task: Record<Phase, string> = {
      collecting:
        "写一条收集期的群公告：说明进度（用给出的人数），提醒还没填的人点链接跟局长私聊，强调不方便在群里说的可以私下告诉局长、只有局长知道。",
      voting: "写一条投票期的群公告：逐个列出方案（标签、时间、店、人均、一句话概括），说局长推荐哪个和理由，提醒大家点链接在局页里投票（不是在群里回复），过半自动定局。",
      confirmed:
        "写一条定局群公告（时间、店名、地址、人数）；再写给店家的订位话术 reservationScript（2–3 句）；再写局长和店员的模拟订位对白 reservationDialog（6–10 句，局长 / 店员交替，含人数、时间和给出的公开需求如鸳鸯锅）。",
      settling: "写一条结算期的群公告：只说总额和已转人数，说明每人金额局长已私下发了、没转的局长会私下提醒，群里不点名。",
      cancelled: "写一条这次没凑成的群公告，轻松一点，说下次再约。",
    };
    const out = llmGroupSchema.parse(
      await callLlmJson({
        system: [
          "你是组局助手“局长”，在帮发起人写可以直接复制到微信群里的话。语气轻松、简短、像朋友。",
          task[phase],
          phase === "confirmed" ? `订位时可以提的公开需求：${publicNeeds(facts).join("；") || "无"}。` : "不是定局阶段时 reservationScript 和 reservationDialog 给 null。",
          PUBLIC_RULES,
        ].join("\n"),
        user: `事实（JSON）：\n${factsText}`,
        schema: llmGroupJsonSchema,
        maxTokens: 1200,
      }),
    );
    const grounded = (s: string) => publicSafe(s, factsText);
    const broadcast = grounded(out.broadcast) && mustMention(out.broadcast, facts, phase) ? out.broadcast : rule.broadcast;
    if (phase !== "confirmed") return { ...rule, broadcast };
    const dialogOk =
      out.reservationDialog &&
      out.reservationDialog.some((l) => l.who === "局长") &&
      out.reservationDialog.some((l) => l.who === "店员") &&
      out.reservationDialog.every((l) => grounded(l.text)) &&
      out.reservationDialog.some((l) => l.text.includes(String(facts.confirmed?.headcount ?? "")));
    return {
      ...rule,
      broadcast,
      reservationScript:
        out.reservationScript && grounded(out.reservationScript) ? out.reservationScript : rule.reservationScript,
      reservationDialog: dialogOk ? out.reservationDialog : rule.reservationDialog,
    };
  } catch (e) {
    warn("groupMessages", e);
    return rule;
  }
}

/** LLM 群公告必须带上关键信息，否则用规则版 */
function mustMention(text: string, facts: PublicFacts, phase: Phase): boolean {
  if (phase === "confirmed" && facts.confirmed) return text.includes(facts.confirmed.poiName);
  if (phase === "settling" && facts.settlement) {
    return text.includes(formatMoney(facts.settlement.total)) && text.includes(String(facts.settlement.paidCount));
  }
  if (phase === "voting") return (facts.proposals ?? []).every((p) => text.includes(p.poiName));
  return true;
}

// ================================================================ writeRecap

export function ruleRecap(facts: PublicFacts, photoCount: number): string {
  const cf = facts.confirmed;
  const head = cf
    ? `${cf.slotLabel}，${cf.headcount} 个人在${cf.poiName}凑齐了「${facts.title}」。`
    : `「${facts.title}」圆满结束。`;
  const photos = photoCount > 0 ? `留下了 ${photoCount} 张照片，` : "";
  const settle = facts.settlement ? `账也算清了（一共 ${formatMoney(facts.settlement.total)} 元）。` : "";
  return `${head}${photos}${settle}${settle ? "" : "大家都辛苦啦，"}下次还是这拨人，再约！`;
}

export async function writeRecap(facts: PublicFacts, photoCount: number): Promise<string> {
  const rule = ruleRecap(facts, photoCount);
  if (currentProvider() === "rules") return rule;
  try {
    const factsText = JSON.stringify({ ...facts, photoCount });
    const out = llmRecapSchema.parse(
      await callLlmJson({
        system: [
          "你是组局助手“局长”。这次聚会结束了，写一段局后回顾（2–3 句，≤100 字），温暖、有点俏皮，结尾可以约下次。",
          "可以提时间、店名、人数、照片数；不要编造发生了什么具体事情（比如谁喝醉了、吃了什么菜）。",
          PUBLIC_RULES,
        ].join("\n"),
        user: `事实（JSON）：\n${factsText}`,
        schema: llmRecapJsonSchema,
        maxTokens: 400,
      }),
    );
    return charLen(out.recap) <= 160 && publicSafe(out.recap, factsText) ? out.recap : rule;
  } catch (e) {
    warn("writeRecap", e);
    return rule;
  }
}

